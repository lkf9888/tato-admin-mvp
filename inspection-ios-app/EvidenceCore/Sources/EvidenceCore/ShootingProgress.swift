import Foundation

/// What a session still needs before it can be handed in.
public enum Requirement: Sendable, Equatable {
    /// The car is not covered yet. Carries the thinnest region so the screen
    /// can say which way to walk rather than "keep going".
    case moreCoverage(thinnest: CarRegion?, fraction: Double)
    /// Turo asks for at least eight interior photographs.
    case moreInterior(shortBy: Int)
    /// Turo asks for at least fifteen exterior photographs. Coverage usually
    /// satisfies this on its own; this catches the photographer who backed up
    /// and got the whole car in four wide shots.
    case moreExterior(shortBy: Int)
}

/// How a shoot is going.
///
/// **There is no upper bound anywhere in here, by decision.** More
/// photographs make a claim more likely to succeed, so nothing in the app may
/// suggest that enough have been taken — the thresholds below are floors that
/// unlock the finish button, never a target that closes the session. Once
/// they are met the photographer decides when to stop, and the screen goes on
/// encouraging rather than congratulating.
public struct ShootingProgress: Sendable, Equatable {

    /// Where the finish button appears. Not 100%: a tow bar, a roof box or a
    /// car parked tight against a wall can leave patches permanently
    /// unreachable, and a photographer who cannot finish is a photographer
    /// who goes back to the camera app.
    public static let coverageToFinish = 0.90

    /// Turo's published floors for host trip photos.
    public static let exteriorFloor = 15
    public static let interiorFloor = 8

    public var coverage: Double
    public var exteriorShots: Int
    public var interiorShots: Int
    public var thinnestRegion: CarRegion?

    public init(
        coverage: Double,
        exteriorShots: Int,
        interiorShots: Int,
        thinnestRegion: CarRegion? = nil
    ) {
        self.coverage = coverage
        self.exteriorShots = exteriorShots
        self.interiorShots = interiorShots
        self.thinnestRegion = thinnestRegion
    }

    public var totalShots: Int { exteriorShots + interiorShots }

    /// Everything still outstanding, most important first.
    public var outstanding: [Requirement] {
        var requirements: [Requirement] = []
        if coverage < Self.coverageToFinish {
            requirements.append(.moreCoverage(thinnest: thinnestRegion, fraction: coverage))
        }
        if interiorShots < Self.interiorFloor {
            requirements.append(.moreInterior(shortBy: Self.interiorFloor - interiorShots))
        }
        if exteriorShots < Self.exteriorFloor {
            requirements.append(.moreExterior(shortBy: Self.exteriorFloor - exteriorShots))
        }
        return requirements
    }

    public var canFinish: Bool { outstanding.isEmpty }

    /// The one thing to put on screen. A list of outstanding requirements is
    /// a form; one sentence is an instruction.
    public var instruction: String {
        switch outstanding.first {
        case .moreCoverage(let thinnest, let fraction):
            // Nothing shot yet. Say the thing that makes the app usable
            // without instruction: there is no right angle to start from.
            if totalShots == 0 { return "对着车拍第一张，从哪个角度开始都行" }
            // Shooting, but the car has not been located yet — naming a
            // region here would be guessing, since every region reads as
            // empty until there is something to paint.
            if fraction < 0.01 { return "绕着车继续拍" }
            guard let thinnest else { return "绕着车继续拍" }
            return "还差\(thinnest.titleZH)，走过去拍"
        case .moreInterior(let shortBy):
            return "拍车内，还差 \(shortBy) 张"
        case .moreExterior(let shortBy):
            return "再拍 \(shortBy) 张外观，站近一点"
        case nil:
            // Past the floor, and the session is still open. Say something
            // that invites more rather than declaring victory.
            return "够交单了 —— 多拍几张，理赔更稳"
        }
    }
}
