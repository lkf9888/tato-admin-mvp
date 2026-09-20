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
    public var id: String { "shot-\(sequence)" }

    /// Where on the car this photograph turned out to be pointing.
    ///
    /// **Derived from the camera's pose after the shutter, never chosen
    /// before it.** The photographer shoots wherever they like; this is how
    /// the review page can still put the handover and the return of the same
    /// corner side by side afterwards.
    public var region: CarRegion
    /// Position in the session, from 1. Not a retake counter — there is
    /// nothing to retake, because there are no slots to fill.
    public var sequence: Int
    public var filename: String
    public var byteCount: Int
    public var sha256: String
    public var capturedAt: Date
    public var quality: ImageQualityReport
    public var evidence: EvidenceCheck
    public var metadataPath: MetadataPath
    /// Whether the photograph cleared the quality gate. A rejected one is
    /// still archived — it is part of the record of how the walk-around went
    /// — but it does not count towards coverage or the floors.
    public var accepted: Bool
    /// Problems the operator was shown and waved through. Empty on a clean
    /// pass. Non-empty means somebody made a judgement call that is now on
    /// the record with their name against it.
    public var acceptedDespite: [ImageQualityIssue]

    public init(
        region: CarRegion,
        sequence: Int,
        filename: String,
        byteCount: Int,
        sha256: String,
        capturedAt: Date,
        quality: ImageQualityReport,
        evidence: EvidenceCheck,
        metadataPath: MetadataPath,
        accepted: Bool,
        acceptedDespite: [ImageQualityIssue] = []
    ) {
        self.region = region
        self.sequence = sequence
        self.filename = filename
        self.byteCount = byteCount
        self.sha256 = sha256
        self.capturedAt = capturedAt
        self.quality = quality
        self.evidence = evidence
        self.metadataPath = metadataPath
        self.accepted = accepted
        self.acceptedDespite = acceptedDespite
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
    /// Which parts of the car have been photographed well enough to count.
    /// Persisted so a session survives the app being killed mid-walk.
    public var coverage: SurfaceCoverage

    public init(
        sessionID: String,
        kind: SessionKind,
        vehicleLabel: String,
        staffLabel: String,
        deviceModel: String,
        appVersion: String,
        startedAt: Date,
        timeZoneIdentifier: String,
        records: [CaptureRecord] = [],
        coverage: SurfaceCoverage = SurfaceCoverage()
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
        self.coverage = coverage
    }

    public var acceptedRecords: [CaptureRecord] { records.filter(\.accepted) }

    public var exteriorShots: Int { acceptedRecords.filter { $0.region != .interior }.count }
    public var interiorShots: Int { acceptedRecords.filter { $0.region == .interior }.count }

    public func progress() -> ShootingProgress {
        ShootingProgress(
            coverage: coverage.fraction,
            exteriorShots: exteriorShots,
            interiorShots: interiorShots,
            thinnestRegion: coverage.thinnestRegion()
        )
    }

    /// Accepted photographs that would still be rejected unread — almost
    /// always a missing location, which is a fixable, human problem.
    public var recordsMissingEvidence: [CaptureRecord] {
        acceptedRecords.filter { !$0.evidence.isClaimReady }
    }

    /// Accepted photographs a person waved through after the gate turned
    /// them down.
    public var recordsQualityOverridden: [CaptureRecord] {
        acceptedRecords.filter { !$0.acceptedDespite.isEmpty }
    }

    /// The best photograph of each region, for the side-by-side review.
    /// "Best" is the sharpest, which is the only ordering that needs no
    /// human judgement.
    public func sharpestByRegion() -> [CarRegion: CaptureRecord] {
        var best: [CarRegion: CaptureRecord] = [:]
        for record in acceptedRecords {
            if let current = best[record.region],
               current.quality.laplacianVariance >= record.quality.laplacianVariance { continue }
            best[record.region] = record
        }
        return best
    }
}
