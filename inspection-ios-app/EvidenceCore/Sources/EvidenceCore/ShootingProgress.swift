import Foundation

/// What a session still needs before it can be handed in.
public enum Requirement: Sendable, Equatable {
    /// A step of the plan, and how many photographs short it is.
    case step(ShotStep, shortBy: Int)
    /// The walk-around has the photographs but not the angles. Carries the
    /// bearing of the thinnest part **relative to where the photographer is
    /// looking**, in signed degrees, so the screen can say "on your left"
    /// rather than naming an end of the car it cannot actually identify.
    case moreCoverage(bearing: Double?, fraction: Double)
}

/// How a shoot is going.
///
/// **There is no upper bound anywhere in here, by decision.** More
/// photographs make a claim more likely to succeed, so nothing in the app may
/// suggest that enough have been taken — the numbers in `ShotStep.required`
/// are floors that unlock the finish button, never a target that closes the
/// session. Once they are met the photographer decides when to stop, and the
/// screen goes on encouraging rather than congratulating.
public struct ShootingProgress: Sendable, Equatable {

    /// Where the walk-around stops asking. Not 100%: a tow bar, a roof box or
    /// a car parked tight against a wall can leave patches permanently
    /// unreachable, and a photographer who cannot finish is a photographer
    /// who goes back to the camera app.
    public static let coverageToFinish = 0.90

    /// The fleet's own floors, above Turo's published fifteen.
    ///
    /// ⚠️ Not gates any more — `ShotPlan` is the gate. They are kept because
    /// they are the promise the fleet made, and `testThePlanClearsTheFleetFloors`
    /// holds the plan to them: change a step's quota and that test says
    /// whether the promise still holds, instead of two sets of rules
    /// disagreeing on a phone in a car park.
    public static let exteriorFloor = 30
    public static let interiorFloor = 8

    public var coverage: Double
    public var roofCoverage: Double
    public var exteriorShots: Int
    public var interiorShots: Int
    /// Accepted photographs filed against each step of the plan.
    public var shotsByStep: [ShotStep: Int]
    /// False when the geometry has nothing to grade the walk-around against —
    /// no car located, or a device that cannot scan. The count then stands on
    /// its own, because a requirement nobody can clear teaches people to
    /// ignore the others.
    public var coverageIsMeasurable: Bool
    /// Signed degrees from where the camera points to the thinnest part of
    /// the car, positive to the photographer's right.
    public var thinnestBearing: Double?

    public init(
        coverage: Double,
        exteriorShots: Int,
        interiorShots: Int,
        roofCoverage: Double = 0,
        shotsByStep: [ShotStep: Int] = [:],
        coverageIsMeasurable: Bool = true,
        thinnestBearing: Double? = nil
    ) {
        self.coverage = coverage
        self.roofCoverage = roofCoverage
        self.exteriorShots = exteriorShots
        self.interiorShots = interiorShots
        self.shotsByStep = shotsByStep
        self.coverageIsMeasurable = coverageIsMeasurable
        self.thinnestBearing = thinnestBearing
    }

    public var totalShots: Int { exteriorShots + interiorShots }

    // MARK: - The plan

    public func taken(_ step: ShotStep) -> Int { shotsByStep[step] ?? 0 }

    public func shortBy(_ step: ShotStep) -> Int { max(step.required - taken(step), 0) }

    public func isComplete(_ step: ShotStep) -> Bool {
        guard taken(step) >= step.required else { return false }
        if step.isGradedByCoverage && coverageIsMeasurable {
            return coverage >= Self.coverageToFinish
        }
        return true
    }

    /// The step the overlay is drawing and the next photograph will be filed
    /// against. Nil once the whole plan is met, which is when the finish
    /// button appears.
    public var currentStep: ShotStep? {
        ShotStep.allCases.first { !isComplete($0) }
    }

    /// Everything still outstanding, in the order it is asked for.
    public var outstanding: [Requirement] {
        ShotStep.allCases.compactMap { step in
            guard !isComplete(step) else { return nil }
            let short = shortBy(step)
            // A graded step with its photographs in is short of angles, not
            // of shutter presses.
            guard short > 0 else {
                return .moreCoverage(bearing: thinnestBearing, fraction: coverage)
            }
            return .step(step, shortBy: short)
        }
    }

    public var canFinish: Bool { currentStep == nil }

    /// The one thing to put on screen. A list of outstanding requirements is
    /// a form; one sentence is an instruction.
    ///
    /// ⚠️ It does not repeat the count. The strip under the viewfinder shows
    /// "12 / 20" already, and the sentence is worth more spent on the thing
    /// the counter cannot say — which way to walk.
    public var instruction: String {
        guard let step = currentStep else {
            // Past the plan, and the session is still open. Say something
            // that invites more rather than declaring victory.
            return "够交单了 —— 多拍几张，理赔更稳"
        }
        guard step.isGradedByCoverage else { return step.hintZH }

        // The walk-around, where the app has something to add. Before a few
        // photographs are in there is no fitted car and no bearing worth
        // trusting, so it just says what to do.
        if taken(step) < 3 || !coverageIsMeasurable { return step.hintZH }
        guard coverage < Self.coverageToFinish, let bearing = thinnestBearing else {
            return shortBy(step) > 0 ? step.hintZH : "绕着车继续拍"
        }
        return Self.walkThisWay(bearing)
    }

    /// What to put **under** the frame, when the drawing in the middle of it
    /// is not already saying the same thing.
    ///
    /// ⚠️ Nil for most steps, and that is the point. The guide overlay now
    /// carries the step's own words; printing them again at the bottom of the
    /// viewfinder reads as *two* instructions, and somebody stops to work out
    /// how the second one differs from the first. What is left here is only
    /// what a drawing cannot hold: which way to walk, and that the session may
    /// now be handed in.
    public var directive: String? {
        let sentence = instruction
        return sentence == currentStep?.hintZH ? nil : sentence
    }

    /// ⚠️ A direction, never a part of the car.
    ///
    /// The app cannot tell a bonnet from a boot. The shape is fitted by
    /// principal component analysis, which finds an axis and not a heading,
    /// and the end nearest the photographer at the moment of the fit was
    /// called the front — which was defensible only while a shot list made
    /// everyone start there. That list named positions; this one names
    /// subjects and still says nothing about which end is which. Saying
    /// "还差车尾" when the photographer has been shooting nothing but the boot
    /// is worse than saying nothing, because they stop believing the next
    /// instruction too.
    static func walkThisWay(_ bearing: Double) -> String {
        switch abs(bearing) {
        case ..<25: return "还差你正前方那块，走近一点拍"
        case ..<115: return bearing < 0 ? "往你左边走，那边还没拍" : "往你右边走，那边还没拍"
        default: return "绕到车的另一边，那边还没拍"
        }
    }
}
