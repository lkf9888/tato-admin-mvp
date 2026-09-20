import CoreMotion
import EvidenceCore
import Foundation

/// Watches how much the phone is moving, so the shutter can be held back
/// until it settles rather than the photograph judged after the fact.
///
/// All the judgement lives in `SteadinessGate`, which is arithmetic and has
/// tests. This is the part that cannot be tested: the sensor.
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
        }
    }

    func stop() {
        motion.stopDeviceMotionUpdates()
        gate.reset()
        rotationRate = 0
        isSteady = true
    }
}
