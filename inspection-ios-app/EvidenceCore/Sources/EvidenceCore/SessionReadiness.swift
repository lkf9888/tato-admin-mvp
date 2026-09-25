import Foundation

/// What stops a session being handed in at all.
///
/// ⚠️ One thing, and it is not the plan. A session with no photographs in it
/// is not a session; a session short of the plan is a session with gaps,
/// and the gaps are reported as warnings. This app guides; it does not hold
/// anybody's work hostage to a checklist.
public enum SessionBlocker: Sendable, Equatable, Hashable {
    case keepShooting(instruction: String)
}

/// Something wrong with a session that is nonetheless finishable.
///
/// Warnings are not blockers on purpose. Every one has a legitimate cause — an
/// underground car park with no satellite fix, a car wedged against a wall —
/// and a phone that refuses to finish is a phone that gets abandoned for the
/// camera app. What the warnings buy is that nobody finds out months later,
/// from an insurer.
public enum SessionWarning: Sendable, Equatable, Hashable {
    case missingLocation(count: Int)
    case qualityOverridden(count: Int)
    /// Not photographed from every direction. Worth seeing before walking
    /// off, since one more minute closes the gap.
    case partialCoverage(fraction: Double, thinnest: CarRegion?)
    /// Steps of the plan still short of photographs. A reminder of what a
    /// claim will want, never a condition.
    case planIncomplete([Requirement])
}

public struct SessionReadiness: Sendable, Equatable {
    public var blockers: [SessionBlocker]
    public var warnings: [SessionWarning]

    public var canFinish: Bool { blockers.isEmpty }
    public var needsAcknowledgement: Bool { canFinish && !warnings.isEmpty }
}

public extension SessionManifest {

    func readiness() -> SessionReadiness {
        let progress = progress()
        var blockers: [SessionBlocker] = []
        var warnings: [SessionWarning] = []

        if !progress.canHandIn {
            blockers.append(.keepShooting(instruction: "还没有拍照片"))
        }
        if !progress.outstanding.isEmpty {
            warnings.append(.planIncomplete(progress.outstanding))
        }

        let missing = recordsMissingEvidence.count
        if missing > 0 { warnings.append(.missingLocation(count: missing)) }

        let overridden = recordsQualityOverridden.count
        if overridden > 0 { warnings.append(.qualityOverridden(count: overridden)) }

        // Only when there is a ring to speak of. A phone with no motion
        // sensor, or a session of nothing but interior photographs, has no
        // headings at all, and "0% of directions" would be a false alarm.
        if progress.canHandIn, !headings.isEmpty, headings.fraction < 0.999 {
            warnings.append(.partialCoverage(fraction: headings.fraction, thinnest: nil))
        }

        return SessionReadiness(blockers: blockers, warnings: warnings)
    }
}


/// What a file picked out of the photo library turns out to be.
///
/// The distinction matters because the two negative answers call for opposite
/// reactions. A photograph that is not ours proves nothing about the delivery
/// path — it is just somebody's holiday snap. A photograph that *is* ours and
/// whose bytes have changed is proof that something in the path re-encodes,
/// and that the path cannot carry evidence.
///
/// Reporting "not the original" for both would cry wolf on every camera roll
/// photo and train people to ignore the one case that matters.
public enum Provenance: Sendable, Equatable {
    case original(filename: String, vehicleLabel: String)
    /// Taken at the same instant as one of ours, but the bytes differ —
    /// something in the path re-encoded it.
    case altered(filename: String, vehicleLabel: String)
    case unknown
}

public extension SessionManifest {

    /// Two seconds of slack, because EXIF capture times are whole seconds and
    /// the archived `Date` is not.
    private static var captureTimeSlack: TimeInterval { 2 }

    func provenance(ofDigest digest: String, capturedAt: Date?) -> Provenance {
        if let match = records.first(where: { $0.sha256.caseInsensitiveCompare(digest) == .orderedSame }) {
            return .original(filename: match.filename, vehicleLabel: vehicleLabel)
        }
        guard let capturedAt else { return .unknown }
        if let sameMoment = records.first(where: {
            abs($0.capturedAt.timeIntervalSince(capturedAt)) < Self.captureTimeSlack
        }) {
            return .altered(filename: sameMoment.filename, vehicleLabel: vehicleLabel)
        }
        return .unknown
    }
}
