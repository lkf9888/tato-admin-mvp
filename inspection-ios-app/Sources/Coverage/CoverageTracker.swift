import ARKit
import EvidenceCore
import Foundation

/// Watches where the phone is and paints the car as it gets photographed.
///
/// **No calibration step, by design.** The old build had a button that said
/// "identify vehicle" and, on phones without a depth sensor, a two-tap ritual
/// at the bumpers. Both were the app asking to be understood before it would
/// do anything. Here the fit runs by itself while the photographer is already
/// shooting, retries until it finds something car-shaped, and the coverage
/// diagram simply appears when it does. Photographs taken before then are
/// archived normally; they just do not count towards coverage, and the first
/// successful fit sweeps up whatever poses were recorded in the meantime.
///
/// On a phone with no depth sensor there is nothing to fit, so no diagram
/// appears and the session falls back to counting photographs against Turo's
/// floors. That is a smaller feature, not a broken one — and it is what a
/// consumer iPhone will do when this is sold to other hosts.
@MainActor
@Observable
final class CoverageTracker: NSObject, ARSessionDelegate {

    private(set) var vehicleFrame: VehicleFrame?
    private(set) var coverage = SurfaceCoverage()
    private(set) var isTracking = false
    /// True when the device can measure the car at all.
    private(set) var canMeasure = false
    /// True while something else holds the camera. Worth knowing because
    /// ARKit and the photo capture session want the same back camera, and
    /// whichever asks last gets it — an interrupted AR session is how that
    /// contest announces itself.
    private(set) var isInterrupted = false

    private let session = ARSession()
    private var meshAnchors: [UUID: ARMeshAnchor] = [:]
    private var groundY: Float?
    private var cameraPosition: SIMD3<Float>?
    private var cameraForward: SIMD3<Float>?
    private var lastFitAttempt = Date.distantPast
    /// Kept so the session can be resumed without resetting tracking, which
    /// would throw away a car that has already been found.
    private var configuration: ARWorldTrackingConfiguration?
    /// Poses of photographs taken before the car was found, so the first
    /// successful fit can credit them rather than throwing them away.
    private var pendingPoses: [(position: SIMD3<Float>, forward: SIMD3<Float>)] = []

    /// How wide an arc of the car one photograph documents, measured across
    /// the screen rather than across the sensor. Overwritten with the real
    /// figure once the capture device is configured, and again every time
    /// the photographer switches between 0.5x and 1x -- the two lenses see
    /// roughly twice as much of the car as each other, so a stale value here
    /// paints the diagram green for panels nobody photographed.
    var fieldOfViewDegrees: Double = 55

    var hasFrame: Bool { vehicleFrame != nil }

    func start() {
        guard ARWorldTrackingConfiguration.isSupported else { return }
        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal]
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            configuration.sceneReconstruction = .mesh
            canMeasure = true
        }
        session.delegate = self
        self.configuration = configuration
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    /// Picks tracking back up after the screen has been away.
    ///
    /// ⚠️ Deliberately *not* `start()`: re-running with `.resetTracking`
    /// would discard the fitted car and the painted coverage, so a
    /// photographer who glanced at the settings sheet would come back to a
    /// blank diagram and have to walk round again. Without the reset option
    /// ARKit relocalises against what it already knows.
    func resume() {
        guard let configuration else {
            start()
            return
        }
        session.run(configuration)
    }

    func pause() {
        session.pause()
        isTracking = false
    }

    func stop() {
        session.pause()
        isTracking = false
        configuration = nil
    }

    /// Restores a coverage map from a session being resumed.
    func resume(coverage: SurfaceCoverage) {
        self.coverage = coverage
    }

    // MARK: - Painting

    /// Credits a photograph taken at the current pose.
    ///
    /// Returns the region it turned out to document, which is what the
    /// archive files it under — worked out after the shutter, never chosen
    /// before it.
    @discardableResult
    func recordShot() -> CarRegion {
        guard let position = cameraPosition, let forward = cameraForward else { return .front }

        guard let frame = vehicleFrame else {
            // Not fitted yet. Keep the pose; the first good fit will use it.
            pendingPoses.append((position, forward))
            if pendingPoses.count > 64 { pendingPoses.removeFirst() }
            return .front
        }

        if frame.contains(position) { return .interior }

        let patches = CoverageProjection.patches(
            seenFrom: position,
            looking: forward,
            horizontalFieldOfViewDegrees: fieldOfViewDegrees,
            of: frame
        )
        coverage.add(patches)
        return Self.dominantRegion(of: patches) ?? .front
    }

    /// Where to send the photographer next, in their own frame of reference:
    /// signed degrees from where they are looking, positive to their right.
    func bearingToThinnestRegion() -> (region: CarRegion, degrees: Double)? {
        guard let frame = vehicleFrame,
              let position = cameraPosition,
              let forward = cameraForward,
              let region = coverage.thinnestRegion() else { return nil }
        guard let degrees = Bearing.relative(to: frame.lookAt(region), from: position, facing: forward) else {
            return nil
        }
        return (region, degrees)
    }

    private static func dominantRegion(of patches: Set<CoveragePatch>) -> CarRegion? {
        var tally: [CarRegion: Int] = [:]
        for patch in patches {
            tally[SurfaceCoverage.region(ofSector: patch.sector, band: patch.band), default: 0] += 1
        }
        return tally.max { $0.value < $1.value }?.key
    }

    // MARK: - Finding the car, without being asked

    private func attemptFit() {
        guard vehicleFrame == nil, canMeasure,
              let observer = cameraPosition,
              let ground = groundY,
              Date().timeIntervalSince(lastFitAttempt) > 1.5 else { return }
        lastFitAttempt = Date()

        // Only what is near the photographer. A car park mesh runs to
        // hundreds of thousands of vertices, nearly all of it other people's
        // cars, and fitting a box to all of that finds the car park.
        let nearby = meshAnchors.values
            .flatMap { Self.worldVertices(of: $0) }
            .filter { simd_distance(SIMD3($0.x, 0, $0.z), SIMD3(observer.x, 0, observer.z)) < 8 }
        guard nearby.count >= 256,
              let frame = VehicleFrameFitter.fit(points: nearby, groundY: ground, observedFrom: observer)
        else { return }

        vehicleFrame = frame
        // Credit the photographs taken while the car was still being found.
        for pose in pendingPoses {
            guard !frame.contains(pose.position) else { continue }
            coverage.add(CoverageProjection.patches(
                seenFrom: pose.position,
                looking: pose.forward,
                horizontalFieldOfViewDegrees: fieldOfViewDegrees,
                of: frame
            ))
        }
        pendingPoses.removeAll()
    }

    // MARK: - ARSessionDelegate

    nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let transform = frame.camera.transform
        let position = SIMD3<Float>(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
        // An ARKit camera looks along its own -Z.
        let forward = -SIMD3<Float>(transform.columns.2.x, transform.columns.2.y, transform.columns.2.z)
        let usable: Bool
        if case .normal = frame.camera.trackingState { usable = true } else { usable = false }

        Task { @MainActor in
            self.cameraPosition = position
            self.cameraForward = forward
            self.isTracking = usable
            if usable { self.attemptFit() }
        }
    }

    nonisolated func sessionWasInterrupted(_ session: ARSession) {
        Task { @MainActor in
            self.isInterrupted = true
            self.isTracking = false
        }
    }

    nonisolated func sessionInterruptionEnded(_ session: ARSession) {
        Task { @MainActor in self.isInterrupted = false }
    }

    nonisolated func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { absorb(anchors) }
    nonisolated func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { absorb(anchors) }

    nonisolated func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
        let removed = anchors.map(\.identifier)
        Task { @MainActor in
            for identifier in removed { self.meshAnchors[identifier] = nil }
        }
    }

    private nonisolated func absorb(_ anchors: [ARAnchor]) {
        let meshes = anchors.compactMap { $0 as? ARMeshAnchor }
        let planeHeights = anchors
            .compactMap { $0 as? ARPlaneAnchor }
            .filter { $0.alignment == .horizontal }
            .map { $0.transform.columns.3.y }

        Task { @MainActor in
            for mesh in meshes { self.meshAnchors[mesh.identifier] = mesh }
            for height in planeHeights { self.groundY = min(self.groundY ?? height, height) }
        }
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
