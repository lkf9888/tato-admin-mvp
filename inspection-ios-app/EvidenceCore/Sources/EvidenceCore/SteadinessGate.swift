import Foundation

/// Decides, from a stream of rotation-rate samples, whether the shutter
/// should be live.
///
/// Catching shake *before* the shutter is much cheaper than catching blur
/// after it: the photographer is still standing in the right place, still
/// looking at the right panel, and nothing has to be explained to them. The
/// quality gate downstream stays as the backstop.
///
/// The whole thing is arithmetic with no sensor in it, because the property
/// that matters — how long the shutter stays dark after a jolt — is a number,
/// and a number can be measured in a test instead of guessed at in a car park.
///
/// ## Why the two time constants differ
///
/// Rising is slow and falling is fast, and that asymmetry is the design
/// rather than a tuning accident.
///
/// **Slow to go dark**, because pressing the shutter shakes the phone. A gate
/// that reacts instantly can disable the button in the moment between the
/// finger landing and the tap registering, swallowing the very photograph it
/// was trying to protect. That is worse than no gate at all — the staff
/// member presses, nothing happens, and they stop trusting the button.
///
/// **Fast to come back**, because every millisecond the shutter is dark is a
/// millisecond somebody is standing in front of a car unable to work. More
/// photographs is the point of this app, and a hesitant shutter takes fewer.
///
/// One symmetric constant has to choose between those two, and whichever it
/// chooses it is wrong about the other.
public struct SteadinessGate: Sendable, Equatable {

    /// Radians per second, summed across axes, after smoothing. Above this
    /// a hand-held frame smears by more than the quality gate will accept.
    ///
    /// Provisional, like every other threshold in this app. It wants
    /// calibrating against real staff photographs alongside
    /// `ImageQualityThresholds`, and until then it is deliberately generous:
    /// letting a soft frame through costs one retake, while holding the
    /// shutter shut on a steady hand costs the app's credibility.
    public static let shakeAbove = 0.35

    /// The shutter comes back below this.
    ///
    /// The gap beneath `shakeAbove` is what stops the button strobing while
    /// a hand hovers at the boundary. It is narrow on purpose: this gap is
    /// the only thing standing between the photographer and the next shot.
    public static let calmBelow = 0.26

    /// Once dark, the shutter stays dark at least this long, so a jolt right
    /// at the boundary cannot flicker the button faster than anyone can aim
    /// at it. Short enough to sit inside the recovery budget below.
    public static let minimumDarkness: TimeInterval = 0.10

    /// Smoothing windows, in seconds rather than in per-sample weights, so
    /// the behaviour does not change when the sensor's rate does. See the
    /// type comment for why they are not the same number.
    public static let riseWindow: TimeInterval = 0.085
    public static let fallWindow: TimeInterval = 0.030

    /// What the whole feature is answerable to: after the hand settles, the
    /// shutter must be live again within this long. Anything past about
    /// 150ms reads as lag rather than as a camera being careful, and a
    /// photographer who perceives lag takes fewer photographs.
    ///
    /// A test measures the real figure against this.
    public static let recoveryBudget: TimeInterval = 0.20

    /// Whether the shutter should be live.
    ///
    /// **Starts true.** A gate that has been handed no samples — because the
    /// phone has no motion sensor, or access was refused, or the monitor
    /// never started — must never be the reason nobody can take a
    /// photograph. Absence of a reading is not evidence of shake.
    public private(set) var isSteady = true

    /// The smoothed rate the decision was made on. Exposed for diagnostics;
    /// nothing in the app should branch on it.
    public private(set) var smoothedRate: Double = 0

    private var lastTimestamp: TimeInterval?
    private var darkSince: TimeInterval?

    public init() {}

    /// Feeds in one sample and returns whether the shutter should be live.
    ///
    /// `timestamp` is any monotonic clock in seconds — `CMDeviceMotion`'s own
    /// `timestamp` in the app, a counter in the tests.
    @discardableResult
    public mutating func accept(rotationRate: Double, at timestamp: TimeInterval) -> Bool {
        let magnitude = max(0, rotationRate)
        let elapsed = lastTimestamp.map { max(0, timestamp - $0) } ?? 0
        lastTimestamp = timestamp

        if elapsed <= 0 {
            // First sample, or two stamped identically. Nothing to smooth
            // against, so take the reading at face value.
            smoothedRate = magnitude
        } else {
            let window = magnitude > smoothedRate ? Self.riseWindow : Self.fallWindow
            let weight = window > 0 ? min(1, elapsed / window) : 1
            smoothedRate += (magnitude - smoothedRate) * weight
        }

        if isSteady {
            if smoothedRate > Self.shakeAbove {
                isSteady = false
                darkSince = timestamp
            }
        } else if smoothedRate < Self.calmBelow,
                  timestamp - (darkSince ?? timestamp) >= Self.minimumDarkness {
            isSteady = true
            darkSince = nil
        }

        return isSteady
    }

    /// Back to the starting state, shutter live. Used when the monitor stops:
    /// a session that resumes must not inherit a lockout from the last one.
    public mutating func reset() {
        self = SteadinessGate()
    }
}
