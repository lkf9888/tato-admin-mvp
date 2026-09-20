import Foundation

/// Something that stops a session being handed in.
public enum SessionBlocker: Sendable, Equatable, Hashable {
    /// Shots with no accepted photograph. An incomplete set is not a set.
    case shotsOutstanding(count: Int)
}

/// Something wrong with a session that is nonetheless finishable.
///
/// Warnings are not blockers on purpose. Every one of these has a legitimate
/// cause — an underground car park with no satellite fix, a car wedged against
/// a wall so a station cannot be stood in — and a phone that refuses to finish
/// is a phone that gets abandoned for the camera app. What the warnings buy is
/// that nobody finds out months later, from an insurer.
public enum SessionWarning: Sendable, Equatable, Hashable {
    /// Accepted photographs an insurer would reject unread. Almost always a
    /// location that was not available where the car was parked.
    case missingLocation(count: Int)
    /// Accepted photographs taken from somewhere other than the station they
    /// belong to — the signature of four shots of the same corner.
    case takenOffStation(count: Int)
    /// Photographs the quality gate turned down and somebody waved through.
    case qualityOverridden(count: Int)
}

public struct SessionReadiness: Sendable, Equatable {
    public var blockers: [SessionBlocker]
    public var warnings: [SessionWarning]

    public var canFinish: Bool { blockers.isEmpty }
    /// Finishable, but somebody should read the summary before they walk off.
    public var needsAcknowledgement: Bool { canFinish && !warnings.isEmpty }
}

public extension SessionManifest {

    func readiness(in plan: [ShotSlot] = ShotPlan.standard) -> SessionReadiness {
        var blockers: [SessionBlocker] = []
        var warnings: [SessionWarning] = []

        let outstanding = outstandingSlots(in: plan).count
        if outstanding > 0 { blockers.append(.shotsOutstanding(count: outstanding)) }

        let missing = recordsMissingEvidence.count
        if missing > 0 { warnings.append(.missingLocation(count: missing)) }

        let offStation = recordsTakenOffStation.count
        if offStation > 0 { warnings.append(.takenOffStation(count: offStation)) }

        let overridden = acceptedRecords.filter { !$0.acceptedDespite.isEmpty }.count
        if overridden > 0 { warnings.append(.qualityOverridden(count: overridden)) }

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
    /// Digest matches an archived photograph: this is the file the camera
    /// produced, unchanged.
    case original(filename: String, vehicleLabel: String)
    /// Taken at the same instant as one of ours, but the bytes differ —
    /// something in the path re-encoded it.
    case altered(filename: String, vehicleLabel: String)
    /// Nothing in the archive was taken at that moment. Not ours.
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
