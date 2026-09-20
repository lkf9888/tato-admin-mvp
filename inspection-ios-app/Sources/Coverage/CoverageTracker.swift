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
    /// Set by ARKit's interruption callback — a hint, and **only** a hint.
    ///
    /// ⚠️ Never read this on its own. `sessionWasInterrupted` fires when the
    /// photo session takes the camera for a moment at launch and when the app
    /// goes to the background, but `sessionInterruptionEnded` does *not* fire
    /// afterwards if the session was paused and re-run rather than left to
    /// recover by itself — which is exactly what this class does. Read alone
    /// the flag latches true and never clears, and the app reports a conflict
    /// that ended a second after launch, permanently, across relaunches.
    /// `isLive` is the signal that cannot lie: see `trouble`.
    private(set) var isInterrupted = false
    /// Frames arriving from ARKit in the last second.
    ///
    /// ⚠️ The only honest answer to "is the tracker alive". `isTracking`
    /// says what the *last* frame reported, which on a session that has
    /// stopped delivering frames altogether is a reading from whenever that
    /// was — a dead session and a well-tracked one look identical through
    /// it. Counting arrivals cannot be fooled that way.
    private(set) var framesPerSecond = 0
    private(set) var isLive = false
    /// What ARKit said when it gave up, if it did.
    ///
    /// ⚠️ A failed session is **silent**. `sessionWasInterrupted` is for the
    /// camera being borrowed and handed back; an outright failure — the
    /// photo session taking the lens out from under a session that is still
    /// starting up, say — arrives at `didFailWithError` and stops the
    /// session for good. Not implementing that callback is how a tracker
    /// ends up dead with nothing on screen but an absence of frames.
    private(set) var failure: String?
    var restarts = 0

    /// True when tracking should be running and simply is not.
    ///
    /// ⚠️ This class cannot fix it by itself, and it used to try: re-running
    /// the session against a camera the photo pipeline already holds fails
    /// every time, however many times it is repeated. Recovery means
    /// re-ordering *both* sessions, which only the owner of both can do —
    /// see `CaptureSessionModel.recoverTracking`.
    var needsHelp: Bool { canMeasure && hasHadTimeToStart && !isLive }

    /// Starts tracking over, keeping whatever car has already been found.
    func restart() {
        guard let configuration else {
            start()
            return
        }
        session.pause()
        session.run(configuration)
        startWatchdog()
    }

    private let session = ARSession()
    private var meshAnchors: [UUID: ARMeshAnchor] = [:]
    private var groundY: Float?
    private var cameraPosition: SIMD3<Float>?
    private var cameraForward: SIMD3<Float>?
    private var lastFitAttempt = Date.distantPast
    /// Kept so the session can be resumed without resetting tracking, which
    /// would throw away a car that has already been found.
    private var configuration: ARWorldTrackingConfiguration?
    private var framesThisSecond = 0
    private var startedAt: Date?
    private var watchdog: Task<Void, Never>?
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
        startWatchdog()
    }

    /// Counts frames once a second, which is all it takes to tell a tracker
    /// that is working from one that has silently lost the camera.
    private func startWatchdog() {
        startedAt = Date()
        // Optimistic: whatever happened before this run is not evidence
        // about this one. Frames arriving will confirm it; frames not
        // arriving will contradict it within a second.
        isInterrupted = false
        failure = nil
        restarts = 0
        watchdog?.cancel()
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard let self else { return }
                self.framesPerSecond = self.framesThisSecond
                self.framesThisSecond = 0
                let live = self.framesPerSecond > 0
                if live != self.isLive { self.isLive = live }

                if live {
                    self.failure = nil
                }
            }
        }
    }

    /// Long enough for ARKit to have started; before this, silence means
    /// "not yet" rather than "never".
    private var hasHadTimeToStart: Bool {
        guard let startedAt else { return false }
        return Date().timeIntervalSince(startedAt) > 2.5
    }

    /// One line for the settings screen: what the tracker is doing, in terms
    /// somebody standing next to a car can act on.
    var status: String {
        guard ARWorldTrackingConfiguration.isSupported else {
            return "这台手机不支持空间追踪"
        }
        guard canMeasure else {
            return "这台手机没有深度传感器 —— 只按张数计，不画车形图"
        }
        // Frames first, every time. The interruption flag is only consulted
        // to explain a silence, never to contradict an arriving frame.
        if isLive {
            return vehicleFrame == nil
                ? "正常，\(framesPerSecond) 帧/秒 —— 还没认出车"
                : "正常，\(framesPerSecond) 帧/秒 —— 已认出车"
        }
        guard hasHadTimeToStart else { return "正在启动…" }
        let tried = restarts > 0 ? "，已重排 \(restarts) 次" : ""
        if let failure { return "停了 —— \(failure)\(tried)" }
        if isInterrupted { return "停了 —— 摄像头被拍照占用\(tried)" }
        return "停了 —— 收不到空间数据（0 帧/秒）\(tried)"
    }

    /// Only the two states worth interrupting somebody mid-shoot for, and
    /// only once it is too late for them to be startup noise.
    var trouble: String? {
        guard canMeasure, hasHadTimeToStart, !isLive else { return nil }
        return isInterrupted
            ? "车形图停了 —— 摄像头被拍照占用"
            : "车形图停了 —— 收不到空间数据"
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
        startWatchdog()
    }

    func pause() {
        session.pause()
        watchdog?.cancel()
        watchdog = nil
        isTracking = false
        isLive = false
        framesPerSecond = 0
    }

    func stop() {
        pause()
        configuration = nil
        startedAt = nil
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
            self.framesThisSecond += 1
            // A session handing over frames is a session that holds the
            // camera, whatever an older notification claimed.
            if self.isInterrupted { self.isInterrupted = false }
            self.cameraPosition = position
            self.cameraForward = forward
            self.isTracking = usable
            if usable { self.attemptFit() }
        }
    }

    nonisolated func session(_ session: ARSession, didFailWithError error: Error) {
        let reason = (error as NSError).localizedDescription
        Task { @MainActor in
            self.failure = reason
            self.isTracking = false
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
