import Foundation

/// A step of the plan that is still short of photographs.
public struct Requirement: Sendable, Equatable, Hashable {
    public var step: ShotStep
    public var shortBy: Int
}

/// How a shoot is going.
///
/// ## A guide, not a gate
///
/// ⚠️ Nothing in here stops anybody doing anything. It used to: the finish
/// button stayed hidden until every step of the plan was full, and the
/// walk-around would not advance until a surface model agreed it had been
/// photographed from ninety per cent of the way round. On a real car that
/// meant somebody photographing the rear over and over while the app insisted
/// the rear was missing, and an app that is wrong *and* insistent is an app
/// people stop opening.
///
/// So the plan now says what a claim will want, in order, and gets out of the
/// way. Steps advance on their count alone. The ring of directions says which
/// way round is still thin, and nothing more. The session can be handed in
/// the moment there is a photograph in it; the finish page lists what the
/// plan still expected, as information, not as a condition.
///
/// **There is no upper bound either.** More photographs make a claim more
/// likely to succeed, so nothing may suggest that enough have been taken.
public struct ShootingProgress: Sendable, Equatable {

    /// The fleet's own floors, above Turo's published fifteen.
    ///
    /// Not enforced anywhere. They are the promise the fleet made about what a
    /// complete walk-around contains, and `testThePlanClearsTheFleetFloors`
    /// holds the plan to them.
    public static let exteriorFloor = 30
    public static let interiorFloor = 8

    /// How much of the ring of directions has been photographed from, `0...1`.
    public var coverage: Double
    public var exteriorShots: Int
    public var interiorShots: Int
    /// Accepted photographs filed against each step of the plan.
    public var shotsByStep: [ShotStep: Int]
    /// Signed degrees from where the camera points now to the widest stretch
    /// of the ring not yet photographed from. Positive means walk right.
    public var gapBearing: Double?

    public init(
        coverage: Double,
        exteriorShots: Int,
        interiorShots: Int,
        shotsByStep: [ShotStep: Int] = [:],
        gapBearing: Double? = nil
    ) {
        self.coverage = coverage
        self.exteriorShots = exteriorShots
        self.interiorShots = interiorShots
        self.shotsByStep = shotsByStep
        self.gapBearing = gapBearing
    }

    public var totalShots: Int { exteriorShots + interiorShots }

    // MARK: - The plan

    public func taken(_ step: ShotStep) -> Int { shotsByStep[step] ?? 0 }

    public func shortBy(_ step: ShotStep) -> Int { max(step.required - taken(step), 0) }

    /// A step is done when it has its photographs. Nothing else is asked of
    /// it — see the type's documentation for why.
    public func isComplete(_ step: ShotStep) -> Bool { taken(step) >= step.required }

    /// The step the overlay is drawing and the next photograph will be filed
    /// against. Nil once every step has its photographs.
    public var currentStep: ShotStep? {
        ShotStep.allCases.first { !isComplete($0) }
    }

    /// Every step still short, in the order it is asked for. Shown on the
    /// finish page as a reminder; never used to refuse anything.
    public var outstanding: [Requirement] {
        ShotStep.allCases.compactMap { step in
            let short = shortBy(step)
            return short > 0 ? Requirement(step: step, shortBy: short) : nil
        }
    }

    /// Whether everything the plan asks for is in.
    public var planComplete: Bool { currentStep == nil }

    /// Whether there is anything to hand in. One photograph is enough to make
    /// a session worth keeping; the plan is advice about how to make it a
    /// better one.
    public var canHandIn: Bool { totalShots > 0 }

    /// The one thing to put on screen. A list of outstanding requirements is
    /// a form; one sentence is an instruction.
    ///
    /// It does not repeat the count — the caption under the drawing says
    /// "12 / 20" already — and it spends the sentence on the thing the counter
    /// cannot say: which way round is still thin.
    public var instruction: String {
        guard let step = currentStep else {
            // Past the plan, and the session is still open. Say something
            // that invites more rather than declaring victory.
            return "计划里的都拍到了 —— 多拍几张，理赔更稳"
        }
        // Only the walk-around has anything to add, and only once there are a
        // few photographs to measure a gap against.
        guard step == .walkAround, taken(step) >= 3, let gapBearing else { return step.hintZH }
        return Self.walkThisWay(gapBearing)
    }

    /// What to put **under** the frame, when the drawing in the middle of it
    /// is not already saying the same thing.
    ///
    /// ⚠️ Nil for most steps, and that is the point. The guide overlay carries
    /// the step's own words; printing them again at the bottom of the
    /// viewfinder reads as *two* instructions, and somebody stops to work out
    /// how the second one differs from the first. What is left here is only
    /// what a drawing cannot hold: which way to walk, and that the plan is
    /// done.
    public var directive: String? {
        let sentence = instruction
        return sentence == currentStep?.hintZH ? nil : sentence
    }

    /// ⚠️ A direction, never a part of the car.
    ///
    /// The app has no idea which end of the car is which — it knows only
    /// which way the camera has been pointed. Saying "还差车尾" to somebody
    /// who has been photographing nothing but the boot is worse than saying
    /// nothing, because they stop believing the next instruction too.
    ///
    /// `bearing` is positive to the photographer's right.
    public static func walkThisWay(_ bearing: Double) -> String {
        switch abs(bearing) {
        case ..<25: return "就在这一边，再多拍几张"
        case ..<115: return bearing < 0 ? "往你左边走，那边还没拍" : "往你右边走，那边还没拍"
        default: return "绕到车的另一边，那边还没拍"
        }
    }
}
