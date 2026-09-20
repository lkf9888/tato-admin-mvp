import Foundation

/// Which writer put the metadata in the file.
///
/// Recorded per photo rather than assumed per app version, because the answer
/// is decided at runtime on each device: the pipeline asks AVFoundation to
/// write the metadata as it flattens the photo, reads the result back, and
/// only reaches for `ExifStamper` if something did not land.
public enum MetadataPath: String, Sendable, Codable {
    /// AVFoundation wrote it while producing the file. The file has never
    /// been rewritten — the best case, and the usual one.
    case writtenAtCapture
    /// The file came out short of something and was stamped afterwards.
    /// Still lossless, but worth knowing about if a phone does it every time.
    case stampedAfterCapture
}

public enum SessionKind: String, Sendable, Codable {
    case checkout
    case checkin
}

/// One photograph, and everything known about it at the moment it was taken.
public struct CaptureRecord: Sendable, Codable, Equatable, Identifiable {
    public var id: String { "\(slotID)-\(attempt)" }

    public var slotID: String
    /// 1 for the first go. Retakes keep their predecessors: "this slot took
    /// four attempts" is exactly the signal a fleet manager wants, and
    /// deleting the rejects would erase it.
    public var attempt: Int
    public var filename: String
    public var byteCount: Int
    public var sha256: String
    public var capturedAt: Date
    public var quality: ImageQualityReport
    public var evidence: EvidenceCheck
    public var metadataPath: MetadataPath
    /// Whether this is the attempt that counts for the slot.
    public var accepted: Bool
    /// Problems the operator was shown and waved through. Empty on a clean
    /// pass. Non-empty means somebody made a judgement call that is now on
    /// the record with their name against it.
    public var acceptedDespite: [ImageQualityIssue]
    /// Whether the photographer was standing in the plan's station when the
    /// shutter fired. `nil` where position tracking was unavailable — an
    /// unsupported device, tracking lost, or the car never calibrated.
    ///
    /// Recorded rather than enforced. Blocking the shutter over a tracking
    /// wobble would strand somebody in front of a car with a phone refusing
    /// to take a picture; the session summary is the right place to say
    /// "three of these were not taken from where they should have been".
    public var stationVerified: Bool?

    public init(
        slotID: String,
        attempt: Int,
        filename: String,
        byteCount: Int,
        sha256: String,
        capturedAt: Date,
        quality: ImageQualityReport,
        evidence: EvidenceCheck,
        metadataPath: MetadataPath,
        accepted: Bool,
        acceptedDespite: [ImageQualityIssue] = [],
        stationVerified: Bool? = nil
    ) {
        self.slotID = slotID
        self.attempt = attempt
        self.filename = filename
        self.byteCount = byteCount
        self.sha256 = sha256
        self.capturedAt = capturedAt
        self.quality = quality
        self.evidence = evidence
        self.metadataPath = metadataPath
        self.accepted = accepted
        self.acceptedDespite = acceptedDespite
        self.stationVerified = stationVerified
    }
}

/// The index of one walk around one car.
///
/// Written next to the photographs and shipped with them. A recipient who has
/// the folder can recompute every digest and check them against this file
/// without trusting us, our server, or each other.
public struct SessionManifest: Sendable, Codable, Equatable {
    public var sessionID: String
    public var kind: SessionKind
    public var vehicleLabel: String
    public var staffLabel: String
    public var deviceModel: String
    public var appVersion: String
    public var startedAt: Date
    public var timeZoneIdentifier: String
    public var records: [CaptureRecord]

    public init(
        sessionID: String,
        kind: SessionKind,
        vehicleLabel: String,
        staffLabel: String,
        deviceModel: String,
        appVersion: String,
        startedAt: Date,
        timeZoneIdentifier: String,
        records: [CaptureRecord] = []
    ) {
        self.sessionID = sessionID
        self.kind = kind
        self.vehicleLabel = vehicleLabel
        self.staffLabel = staffLabel
        self.deviceModel = deviceModel
        self.appVersion = appVersion
        self.startedAt = startedAt
        self.timeZoneIdentifier = timeZoneIdentifier
        self.records = records
    }

    public var acceptedRecords: [CaptureRecord] { records.filter(\.accepted) }

    public func acceptedRecord(forSlot slotID: String) -> CaptureRecord? {
        records.first { $0.slotID == slotID && $0.accepted }
    }

    /// Slots with no accepted photograph yet.
    public func outstandingSlots(in plan: [ShotSlot] = ShotPlan.standard) -> [ShotSlot] {
        plan.filter { acceptedRecord(forSlot: $0.id) == nil }
    }

    /// Accepted photographs that would still be rejected unread — almost
    /// always a missing location, which is a fixable, human problem.
    public var recordsMissingEvidence: [CaptureRecord] {
        acceptedRecords.filter { !$0.evidence.isClaimReady }
    }

    /// Accepted photographs taken from somewhere other than the station they
    /// were meant to be taken from — four shots of the same corner, rather
    /// than a walk around the car. Excludes photographs where position was
    /// never tracked, which prove nothing either way.
    public var recordsTakenOffStation: [CaptureRecord] {
        acceptedRecords.filter { $0.stationVerified == false }
    }

    public func isComplete(in plan: [ShotSlot] = ShotPlan.standard) -> Bool {
        outstandingSlots(in: plan).isEmpty
    }
}
