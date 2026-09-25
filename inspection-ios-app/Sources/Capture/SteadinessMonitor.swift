import CoreMotion
import EvidenceCore
import Foundation

/// Watches how much the phone is moving, so the shutter can be held back
/// until it settles rather than the photograph judged after the fact — and,
/// from the same stream, which way the camera is facing.
///
/// All the judgement lives in `SteadinessGate` and `CameraHeading`, which are
/// arithmetic and have tests. This is the part that cannot be tested: the
/// sensor.
///
/// ⚠️ One motion manager for both. Apple asks for a single instance per app —
/// several at once compete for the same sensor and each gets fewer updates —
/// and the steadiness gate already runs device motion at 100 Hz, which carries
/// the attitude the heading needs.
@MainActor
@Observable
final class SteadinessMonitor {

    /// 100 Hz, the fastest device motion offers.
    ///
    /// The shutter can come back no sooner than the next sample arrives, so
    /// the sampling interval is a floor under the recovery time. At 30 Hz
    /// that floor is 33ms of the budget spent on nothing.
    private static let updateInterval = 1.0 / 100.0

    /// Whether the shutter should be live.
    ///
    /// Stored rather than computed off the raw rate, and that matters for
    /// more than tidiness: this type is `@Observable`, so a property that
    /// changed with every sample would redraw the camera screen a hundred
    /// times a second. This one changes only when the answer changes.
    ///
    /// **True until something measures otherwise**, including forever on a
    /// phone that cannot measure. A missing sensor must never be the reason
    /// nobody can take a photograph.
    private(set) var isSteady = true

    /// The smoothed rate behind the decision, for the checklist to read off
    /// in the field. Nothing branches on it.
    @ObservationIgnored private(set) var rotationRate: Double = 0

    /// Which way the camera faces, in degrees, for the screen.
    ///
    /// ⚠️ Updated only when it has moved a few degrees, for the same reason
    /// `isSteady` is stored: this type is observed, and a value that changed
    /// with every sample would redraw the camera screen a hundred times a
    /// second to turn a ring by a fraction of a degree. Nil until the camera
    /// has first faced something; after that, the last direction it faced.
    private(set) var heading: Double?

    /// The same, at full rate — what a photograph is credited with. Read at
    /// the moment of the shutter, never shown. Nil while the camera points
    /// too nearly straight up or down to face any side of anything, and a
    /// photograph taken then adds nothing to the ring.
    @ObservationIgnored private(set) var headingNow: Double?

    /// Whether this phone can say which way it faces at all.
    var canTellHeading: Bool { motion.isDeviceMotionAvailable }

    private static let headingStep = 3.0

    @ObservationIgnored private var gate = SteadinessGate()
    @ObservationIgnored private let motion = CMMotionManager()

    func start() {
        guard motion.isDeviceMotionAvailable, !motion.isDeviceMotionActive else { return }
        motion.deviceMotionUpdateInterval = Self.updateInterval
        motion.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let motion else { return }
            let rate = motion.rotationRate
            let magnitude = (rate.x * rate.x + rate.y * rate.y + rate.z * rate.z).squareRoot()

            // `CMDeviceMotion.timestamp` is seconds since boot and monotonic,
            // which is what the gate's windows are measured against. Wall
            // clock would jump when the phone syncs time.
            let steady = self.gate.accept(rotationRate: magnitude, at: motion.timestamp)
            self.rotationRate = self.gate.smoothedRate
            // Assigned only on a real change, so the camera screen is not
            // invalidated a hundred times a second.
            if steady != self.isSteady { self.isSteady = steady }

            let m = motion.attitude.rotationMatrix
            let g = motion.gravity
            let now = CameraHeading.degrees(
                rows: (SIMD3(m.m11, m.m12, m.m13), SIMD3(m.m21, m.m22, m.m23), SIMD3(m.m31, m.m32, m.m33)),
                gravity: SIMD3(g.x, g.y, g.z)
            )
            self.headingNow = now
            // ⚠️ A phone pointed at the floor has no heading, and the one on
            // screen is left where it was rather than cleared: the ring would
            // otherwise snap back to its reference frame every time somebody
            // glanced down at a wheel, which reads as the app losing track.
            guard let now else { return }
            if let shown = self.heading,
               abs(CameraHeading.difference(from: shown, to: now)) < Self.headingStep { return }
            self.heading = now
        }
    }

    func stop() {
        motion.stopDeviceMotionUpdates()
        gate.reset()
        rotationRate = 0
        isSteady = true
        heading = nil
        headingNow = nil
    }
}
