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
    /// There was no file to begin with. ARKit handed over the camera's
    /// processed pixels and its EXIF, and this app encoded the JPEG.
    ///
    /// Recorded rather than glossed over. The pixels and the metadata are
    /// the camera's, and it is a first encode rather than a re-encode — but
    /// "the camera wrote this file" is no longer true, and an archive that
    /// implied otherwise would be lying about the one thing it exists to be
    /// precise about. See `PhotoEncoder`.
    case encodedFromCameraPixels
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
    /// Which step of the plan this photograph was taken for.
    ///
    /// ⚠️ The step the app was *showing* at the moment of the shutter, not a
    /// guess made afterwards. A wheel cannot be recognised from a camera
    /// pose, and a rim photographed as part of a flank is eight pixels wide,
    /// so there is nothing to infer it from later. Nil on a photograph taken
    /// after the plan was met, which is allowed and encouraged.
    ///
    /// ⚠️ Renamed from `closeUp`, and the key in the JSON changed with it. A
    /// manifest written by an older build decodes with this nil rather than
    /// failing — unknown keys are ignored, and an optional that is absent is
    /// simply absent. An archive that will not open is worse than one whose
    /// oldest sessions have forgotten which step a photo belonged to.
    public var step: ShotStep?
    /// The Photos identifier of the copy in the camera roll, once it is
    /// there.
    ///
    /// ⚠️ Written as each photograph is taken, not when a session is handed
    /// in. Turo's own uploader reads the photo library and nothing else, and
    /// a walk-around that gets interrupted — a phone that dies, a guest who
    /// turns up early, somebody who just puts the phone in their pocket —
    /// used to leave every photograph stranded inside this app's container.
    /// The archive is still the evidence; this is the delivery copy, and it
    /// exists from the moment the shutter closes.
    ///
    /// Nil means it is not in the library: never saved, refused permission,
    /// or the save failed. `SessionManifest.recordsNotInLibrary` is what the
    /// finish page tops up.
    public var libraryAssetID: String?

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
        acceptedDespite: [ImageQualityIssue] = [],
        step: ShotStep? = nil,
        libraryAssetID: String? = nil
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
        self.step = step
        self.libraryAssetID = libraryAssetID
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

    /// ⚠️ `thinnestBearing` comes from outside, because it cannot come from
    /// here. Which way to walk depends on where the photographer is standing
    /// and which way they are facing, and a manifest is a record of what was
    /// shot, not a live pose. Passing nil is honest and simply produces
    /// "绕着车继续拍".
    /// How many accepted photographs each step of the plan has.
    public var shotsByStep: [ShotStep: Int] {
        acceptedRecords.reduce(into: [:]) { counts, record in
            guard let step = record.step else { return }
            counts[step, default: 0] += 1
        }
    }

    public func progress(
        thinnestBearing: Double? = nil,
        coverageIsMeasurable: Bool = true
    ) -> ShootingProgress {
        ShootingProgress(
            coverage: coverage.fraction,
            exteriorShots: exteriorShots,
            interiorShots: interiorShots,
            roofCoverage: coverage.roofFraction,
            shotsByStep: shotsByStep,
            coverageIsMeasurable: coverageIsMeasurable,
            thinnestBearing: thinnestBearing
        )
    }

    /// Photographs that are not in the camera roll yet.
    ///
    /// ⚠️ Every photograph, not only the accepted ones. A photograph the
    /// quality gate turned down is still a photograph of this car at this
    /// moment, and the person who took it is the one who decides whether it
    /// is worth attaching to a claim. Dropping it silently is this app's
    /// least forgivable failure mode.
    public var recordsNotInLibrary: [CaptureRecord] {
        records.filter { $0.libraryAssetID == nil }
    }

    public var recordsInLibrary: [CaptureRecord] {
        records.filter { $0.libraryAssetID != nil }
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
