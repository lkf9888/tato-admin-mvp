import ARKit
import EvidenceCore
import Foundation

enum CoverageCapability: String, Sendable {
    /// The car's box is measured off the depth mesh. Pro-model iPhones.
    case sceneReconstruction
    /// Pose is tracked just as well; the car has to be marked by hand.
    case visualInertial
}

enum CalibrationFailure: LocalizedError {
    case notEnoughMesh
    case nothingCarShaped
    case markedPointsImplausible

    var errorDescription: String? {
        switch self {
        case .notEnoughMesh:
            return "还没扫到足够的车身，举着手机沿车走半圈再试。"
        case .nothingCarShaped:
            return "扫到的东西不像一台车，可能对着墙或者旁边那辆车了。手动标一下车头车尾。"
        case .markedPointsImplausible:
            return "车头车尾这两个点对不上一台车，重新标一次。"
        }
    }
}

/// Knows where the photographer is standing relative to the car, and which
/// shot that makes it.
///
/// **One tracker, not two.** The obvious design is a LiDAR engine and a
/// non-LiDAR engine, and it is the wrong one: pose tracking is ARKit's job and
/// it is equally good either way. The only thing the depth sensor changes is
/// how the car's box gets established — measured, or marked by hand. So that
/// is the only thing that branches, and everything downstream is the shared,
/// tested arithmetic in `EvidenceCore`.
///
/// This matters commercially as much as technically. The fleet is on Pro
/// phones today; a Turo host who buys this from the App Store mostly is not.
/// An app that needs LiDAR to function is unsellable to most of that market,
/// and would also fail on a Pro in direct sunlight, where the infrared return
/// washes out and reconstruction quietly stops.
@MainActor
@Observable
final class CoverageTracker: NSObject, ARSessionDelegate {

    private(set) var capability: CoverageCapability = .visualInertial
    private(set) var vehicleFrame: VehicleFrame?
    private(set) var placement: Placement?
    private(set) var guidance: CoverageGuidance?
    /// False while ARKit is initialising or has lost its bearings — the
    /// guidance is meaningless until it is true again.
    private(set) var isTracking = false
    private(set) var calibrationError: String?

    var outstanding: [ShotSlot] = ShotPlan.exterior

    private let session = ARSession()
    private var meshAnchors: [UUID: ARMeshAnchor] = [:]
    private var groundY: Float?
    private var cameraPosition: SIMD3<Float>?
    private var cameraForward: SIMD3<Float>?

    var isCalibrated: Bool { vehicleFrame != nil }

    func start() {
        guard ARWorldTrackingConfiguration.isSupported else { return }

        let configuration = ARWorldTrackingConfiguration()
        // Gives the ground plane, which is what heights are measured from.
        configuration.planeDetection = [.horizontal]
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            configuration.sceneReconstruction = .mesh
            capability = .sceneReconstruction
        }
        session.delegate = self
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    func stop() {
        session.pause()
        isTracking = false
    }

    // MARK: - Calibration

    /// Measures the car off the depth mesh. Pro phones only.
    ///
    /// Called once the photographer has walked far enough for the mesh to
    /// have something in it — not on the first frame, when it holds a patch
    /// of tarmac.
    func calibrateFromMesh() {
        guard capability == .sceneReconstruction,
              let observer = cameraPosition,
              let ground = groundY else {
            calibrationError = CalibrationFailure.notEnoughMesh.errorDescription
            return
        }

        // Only what is near the photographer. A car park mesh runs to
        // hundreds of thousands of vertices, nearly all of it other people's
        // cars, and fitting a box to all of that finds the car park.
        let nearby = meshAnchors.values
            .flatMap { Self.worldVertices(of: $0) }
            .filter { simd_distance(SIMD3($0.x, 0, $0.z), SIMD3(observer.x, 0, observer.z)) < 8 }

        guard nearby.count >= 256 else {
            calibrationError = CalibrationFailure.notEnoughMesh.errorDescription
            return
        }
        guard let frame = VehicleFrameFitter.fit(points: nearby, groundY: ground, observedFrom: observer) else {
            calibrationError = CalibrationFailure.nothingCarShaped.errorDescription
            return
        }

        vehicleFrame = frame
        calibrationError = nil
    }

    /// The fallback for phones without a depth sensor: the photographer
    /// stands at the front bumper, then at the rear bumper.
    ///
    /// Width is assumed rather than measured — 1.85m, a normal car. It only
    /// feeds the distance calculation, where being 10cm out moves a station
    /// by 10cm and the tolerance is a metre and a half.
    func calibrateByHand(nose: SIMD3<Float>, tail: SIMD3<Float>) {
        guard let ground = groundY ?? nose.y as Float? else { return }
        let axis = SIMD3<Float>(nose.x - tail.x, 0, nose.z - tail.z)
        let length = simd_length(axis)
        guard length > 0.5 else {
            calibrationError = CalibrationFailure.markedPointsImplausible.errorDescription
            return
        }

        let midpoint = (nose + tail) / 2
        let frame = VehicleFrame(
            centre: SIMD3(midpoint.x, ground, midpoint.z),
            forward: axis,
            length: length,
            width: 1.85
        )
        guard frame.isPlausible else {
            calibrationError = CalibrationFailure.markedPointsImplausible.errorDescription
            return
        }

        vehicleFrame = frame
        calibrationError = nil
    }

    /// The photographer's current position, for marking the bumpers.
    var currentPosition: SIMD3<Float>? { cameraPosition }

    /// Which way to point the arrow: signed degrees from where the camera is
    /// looking to the next station. Positive is to the photographer's right.
    var bearingToNextStation: Double? {
        guard let frame = vehicleFrame,
              let station = guidance?.nextSlot?.station,
              let position = cameraPosition,
              let forward = cameraForward else { return nil }
        return Bearing.relative(to: frame.worldPosition(for: station), from: position, facing: forward)
    }

    func reset() {
        vehicleFrame = nil
        placement = nil
        guidance = nil
        calibrationError = nil
    }

    // MARK: - ARSessionDelegate

    nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let transform = frame.camera.transform
        let position = SIMD3<Float>(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
        // An ARKit camera looks along its own -Z.
        let forward = -SIMD3<Float>(transform.columns.2.x, transform.columns.2.y, transform.columns.2.z)
        let usable: Bool
        switch frame.camera.trackingState {
        case .normal: usable = true
        default: usable = false
        }

        Task { @MainActor in
            self.cameraPosition = position
            self.cameraForward = forward
            self.isTracking = usable
            self.refreshGuidance(at: position)
        }
    }

    nonisolated func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
        absorb(anchors)
    }

    nonisolated func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        absorb(anchors)
    }

    nonisolated func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
        let removed = anchors.map(\.identifier)
        Task { @MainActor in
            for identifier in removed { self.meshAnchors[identifier] = nil }
        }
    }

    private nonisolated func absorb(_ anchors: [ARAnchor]) {
        let meshes = anchors.compactMap { $0 as? ARMeshAnchor }
        // The lowest horizontal plane is the floor the car is standing on.
        let planeHeights = anchors
            .compactMap { $0 as? ARPlaneAnchor }
            .filter { $0.alignment == .horizontal }
            .map { $0.transform.columns.3.y }

        Task { @MainActor in
            for mesh in meshes { self.meshAnchors[mesh.identifier] = mesh }
            for height in planeHeights {
                self.groundY = min(self.groundY ?? height, height)
            }
        }
    }

    private func refreshGuidance(at position: SIMD3<Float>) {
        guard let frame = vehicleFrame, isTracking else {
            placement = nil
            guidance = nil
            return
        }
        let here = frame.placement(ofCameraAt: position)
        placement = here
        guidance = CoverageMatcher.guidance(for: here, outstanding: outstanding)
    }

    // MARK: - Mesh reading

    /// ⚠️ Vertices are read three floats at a time, not as a `SIMD3<Float>`.
    ///
    /// ARKit packs them at a 12-byte stride; `SIMD3<Float>` has a 16-byte
    /// stride and 16-byte alignment. Binding the buffer to `SIMD3<Float>` and
    /// reading through it looks right, compiles, and walks off the end of the
    /// geometry while reading misaligned garbage on the way.
    private nonisolated static func worldVertices(of anchor: ARMeshAnchor) -> [SIMD3<Float>] {
        let source = anchor.geometry.vertices
        guard source.format == .float3 else { return [] }

        let transform = anchor.transform
        let base = source.buffer.contents()
        var points: [SIMD3<Float>] = []
        points.reserveCapacity(source.count)

        for index in 0..<source.count {
            let pointer = base.advanced(by: source.offset + source.stride * index)
            let local = SIMD3<Float>(
                pointer.assumingMemoryBound(to: Float.self).pointee,
                pointer.advanced(by: 4).assumingMemoryBound(to: Float.self).pointee,
                pointer.advanced(by: 8).assumingMemoryBound(to: Float.self).pointee
            )
            let world = transform * SIMD4<Float>(local, 1)
            points.append(SIMD3(world.x, world.y, world.z))
        }
        return points
    }
}
