import CoreMotion
import Foundation

/// Watches how much the phone is moving, so a shot can be held back until it
/// settles rather than judged after the fact.
///
/// Catching shake before the shutter is cheaper than catching blur after it:
/// the staff member is still standing in the right place, still looking at
/// the right panel. The blur gate downstream is the backstop, not the plan.
@MainActor
@Observable
final class SteadinessMonitor {

    /// Radians per second, summed across axes. Provisional, like every other
    /// threshold here — a number to be replaced once there are real captures
    /// from real staff to calibrate against.
    private static let steadyBelow: Double = 0.28

    private let motion = CMMotionManager()
    private(set) var rotationRate: Double = 0

    var isSteady: Bool { rotationRate < Self.steadyBelow }

    func start() {
        guard motion.isDeviceMotionAvailable, !motion.isDeviceMotionActive else { return }
        motion.deviceMotionUpdateInterval = 1.0 / 30.0
        motion.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let motion else { return }
            let rate = motion.rotationRate
            let magnitude = (rate.x * rate.x + rate.y * rate.y + rate.z * rate.z).squareRoot()
            // Smoothed: a single twitch should not veto a shot, and a shaky
            // hand should not sneak one through between twitches.
            self?.rotationRate = ((self?.rotationRate ?? 0) * 0.7) + (magnitude * 0.3)
        }
    }

    func stop() {
        motion.stopDeviceMotionUpdates()
        rotationRate = 0
    }
}
