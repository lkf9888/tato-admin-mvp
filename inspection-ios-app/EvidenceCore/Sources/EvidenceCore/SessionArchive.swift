import Foundation

public enum ArchiveError: Error, Equatable {
    /// The bytes on disk do not hash to what we just computed in memory.
    /// Nothing is recorded, because an archive whose digests do not match its
    /// files is worse than no archive at all.
    case writeVerificationFailed(String)
    case manifestUnreadable
}

/// The on-disk home of one session: the original files, and a manifest that
/// indexes them.
///
/// ```
/// <root>/<sessionID>/
///     manifest.json
///     photos/001-frontLeft.jpg
///     photos/002-frontLeft.jpg   ← two of the same corner; both are kept
/// ```
///
/// Numbered in sequence rather than named by slot. There are no slots: the
/// photographer shoots wherever they like and as much as they like, and the
/// region in the filename is worked out from the camera's pose afterwards.
///
/// **Nothing is ever read back from the photo library as evidence.** An iOS
/// photo library round trip can hand back a re-encoded copy — different
/// bytes, different digest, sometimes different metadata — and that is
/// precisely the failure this whole app exists to avoid. The originals live
/// here, in the app's own container, and leave as a ZIP of untouched files.
///
/// ⚠️ A *copy* does go to the camera roll, as each photograph is taken, and
/// that is not a contradiction: it goes one way. `LibraryMirror` pushes the
/// same bytes out so Turo's uploader can see them, reads them back, and
/// re-hashes them against this manifest. The camera roll is a delivery
/// channel that has to prove itself every session; this directory is the
/// record.
public actor SessionArchive {
    public nonisolated let root: URL
    /// Fixed at creation, so callers that only need to name things can ask
    /// without hopping onto the actor.
    public nonisolated let startedAt: Date
    public private(set) var manifest: SessionManifest

    // Derived from `root`, which never changes, so they are safe to read
    // from the initialiser before the actor exists.
    private nonisolated var photosDirectory: URL { root.appendingPathComponent("photos", isDirectory: true) }
    private nonisolated var manifestURL: URL { root.appendingPathComponent("manifest.json") }

    public init(parent: URL, manifest: SessionManifest) throws {
        self.root = parent.appendingPathComponent(manifest.sessionID, isDirectory: true)
        self.startedAt = manifest.startedAt
        self.manifest = manifest
        try FileManager.default.createDirectory(at: photosDirectory, withIntermediateDirectories: true)
        try SessionArchive.write(manifest, to: manifestURL)
    }

    public init(existing root: URL) throws {
        self.root = root
        let data = try Data(contentsOf: root.appendingPathComponent("manifest.json"))
        guard let decoded = try? JSONDecoder.evidence.decode(SessionManifest.self, from: data) else {
            throw ArchiveError.manifestUnreadable
        }
        self.startedAt = decoded.startedAt
        self.manifest = decoded
    }

    /// Files a capture and returns its record.
    ///
    /// The digest is computed over exactly the bytes handed in, which are
    /// exactly the bytes written, which are then read back and hashed again
    /// before anything is recorded. Belt and braces, on the one step where a
    /// silent failure would not surface until a claim.
    @discardableResult
    public func store(
        jpeg: Data,
        region: CarRegion,
        capturedAt: Date,
        quality: ImageQualityReport,
        metadataPath: MetadataPath,
        accepted: Bool = true,
        acceptedDespite: [ImageQualityIssue] = [],
        step: ShotStep? = nil
    ) throws -> CaptureRecord {
        let sequence = (manifest.records.map(\.sequence).max() ?? 0) + 1
        let filename = String(format: "%03d-%@.jpg", sequence, region.rawValue)
        let destination = photosDirectory.appendingPathComponent(filename)
        let digest = EvidenceHash.sha256(jpeg)

        try jpeg.write(to: destination, options: .atomic)
        let readBack = try Data(contentsOf: destination)
        guard EvidenceHash.matches(readBack, digest: digest) else {
            try? FileManager.default.removeItem(at: destination)
            throw ArchiveError.writeVerificationFailed(filename)
        }
        // Read-only from here. Not a security boundary — a deterrent against
        // some later well-meaning code editing an original in place.
        try? FileManager.default.setAttributes([.posixPermissions: 0o444], ofItemAtPath: destination.path)

        let record = CaptureRecord(
            region: region,
            sequence: sequence,
            filename: filename,
            byteCount: jpeg.count,
            sha256: digest,
            capturedAt: capturedAt,
            quality: quality,
            evidence: EvidenceRequirements.check(jpeg: jpeg),
            metadataPath: metadataPath,
            accepted: accepted,
            acceptedDespite: acceptedDespite,
            step: step
        )
        manifest.records.append(record)
        try persist()
        return record
    }

    /// Names the car and the occasion.
    ///
    /// Set at the end rather than the beginning. Asking "which car, and are
    /// you handing it over or taking it back?" before the first photograph is
    /// a form standing between somebody and the thing they came to do — and
    /// by the end the app can usually answer both itself, from the plate it
    /// read and the trips the backend knows about.
    public func describe(vehicleLabel: String, kind: SessionKind) throws {
        manifest.vehicleLabel = vehicleLabel
        manifest.kind = kind
        try persist()
    }

    /// Records which directions the walk-around has been photographed from.
    ///
    /// Persisted on every shot, so a session survives the app being killed
    /// mid-walk. The headings are measured against a reference the motion
    /// sensor picks when it starts, so a *new* reference after a relaunch is
    /// not aligned with the old one -- the ring may then show a slice as
    /// fresh that was already done. That errs towards one photograph too
    /// many, which is the right way for a guide to be wrong.
    public func updateHeadingCoverage(_ coverage: HeadingCoverage) throws {
        manifest.headingCoverage = coverage
        try persist()
    }

    /// Records what the car's surface coverage looks like now.
    ///
    /// Persisted on every shot so a session survives the app being killed
    /// mid-walk: coverage is derived from camera poses that no longer exist
    /// once tracking restarts, so losing it would mean starting the car over.
    public func updateCoverage(_ coverage: SurfaceCoverage) throws {
        manifest.coverage = coverage
        try persist()
    }

    /// Records that this photograph now exists in the camera roll as well.
    ///
    /// Persisted with everything else so an interrupted session knows what
    /// it already saved, and so the manifest can say where the delivery copy
    /// went — which is a question a claim can be lost on.
    public func noteLibraryAsset(_ identifier: String, forFilename filename: String) throws {
        guard let index = manifest.records.firstIndex(where: { $0.filename == filename }) else { return }
        manifest.records[index].libraryAssetID = identifier
        try persist()
    }

    /// Counts a photograph the gate turned down, on the operator's say-so.
    ///
    /// The override is recorded against the photograph rather than swallowed:
    /// `acceptedDespite` is what lets a manager see that a blurred shot went
    /// through, and who decided that.
    public func accept(_ record: CaptureRecord, despite issues: [ImageQualityIssue]) throws {
        guard let index = manifest.records.firstIndex(where: { $0.id == record.id }) else { return }
        manifest.records[index].accepted = true
        manifest.records[index].acceptedDespite = issues
        try persist()
    }

    /// Pure path arithmetic over `root`, so callers do not have to hop
    /// onto the actor just to name a file.
    public nonisolated func url(of record: CaptureRecord) -> URL {
        photosDirectory.appendingPathComponent(record.filename)
    }

    /// Re-hashes every accepted file against the manifest.
    ///
    /// Run before export. If this ever disagrees, the honest move is to say so
    /// rather than to ship the files and hope nobody checks.
    public func verifyAcceptedFiles() throws -> [String] {
        var mismatched: [String] = []
        for record in manifest.acceptedRecords {
            let data = try? Data(contentsOf: url(of: record))
            if data.map({ !EvidenceHash.matches($0, digest: record.sha256) }) ?? true {
                mismatched.append(record.filename)
            }
        }
        return mismatched
    }

    private func persist() throws {
        try SessionArchive.write(manifest, to: manifestURL)
    }

    private nonisolated static func write(_ manifest: SessionManifest, to url: URL) throws {
        try JSONEncoder.evidence.encode(manifest).write(to: url, options: .atomic)
    }
}

public extension JSONEncoder {
    static var evidence: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}

public extension JSONDecoder {
    static var evidence: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
