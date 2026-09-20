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
///     photos/front-1.jpg
///     photos/front-2.jpg      ← the first attempt was blurred; both are kept
/// ```
///
/// **Nothing here ever goes near the photo library.** An iOS photo library
/// round trip can hand back a re-encoded copy — different bytes, different
/// digest, sometimes different metadata — and that is precisely the failure
/// this whole app exists to avoid. Photos live in the app's own container and
/// leave it as a ZIP of untouched files.
public actor SessionArchive {
    public nonisolated let root: URL
    public private(set) var manifest: SessionManifest

    // Derived from `root`, which never changes, so they are safe to read
    // from the initialiser before the actor exists.
    private nonisolated var photosDirectory: URL { root.appendingPathComponent("photos", isDirectory: true) }
    private nonisolated var manifestURL: URL { root.appendingPathComponent("manifest.json") }

    public init(parent: URL, manifest: SessionManifest) throws {
        self.root = parent.appendingPathComponent(manifest.sessionID, isDirectory: true)
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
        slot: ShotSlot,
        capturedAt: Date,
        quality: ImageQualityReport,
        metadataPath: MetadataPath,
        accepted: Bool = true,
        acceptedDespite: [ImageQualityIssue] = [],
        stationVerified: Bool? = nil
    ) throws -> CaptureRecord {
        let attempt = (manifest.records.filter { $0.slotID == slot.id }.map(\.attempt).max() ?? 0) + 1
        let filename = "\(slot.id)-\(attempt).jpg"
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
            slotID: slot.id,
            attempt: attempt,
            filename: filename,
            byteCount: jpeg.count,
            sha256: digest,
            capturedAt: capturedAt,
            quality: quality,
            evidence: EvidenceRequirements.check(jpeg: jpeg),
            metadataPath: metadataPath,
            accepted: accepted,
            acceptedDespite: acceptedDespite,
            stationVerified: stationVerified
        )

        // A rejected attempt is filed but does not displace a good photo
        // already taken for that slot.
        if accepted { supersedeAccepted(forSlot: slot.id) }
        manifest.records.append(record)
        try persist()
        return record
    }

    /// Promotes an attempt the gate turned down, on the operator's say-so.
    ///
    /// The override is recorded against the photograph rather than swallowed:
    /// `acceptedDespite` is what lets a manager see that this slot went
    /// through blurred, and who decided that.
    public func accept(_ record: CaptureRecord, despite issues: [ImageQualityIssue]) throws {
        guard let index = manifest.records.firstIndex(where: { $0.id == record.id }) else { return }
        supersedeAccepted(forSlot: record.slotID)
        manifest.records[index].accepted = true
        manifest.records[index].acceptedDespite = issues
        try persist()
    }

    private func supersedeAccepted(forSlot slotID: String) {
        for index in manifest.records.indices where manifest.records[index].slotID == slotID {
            manifest.records[index].accepted = false
        }
    }

    /// How many times this slot has been attempted.
    public func attempts(forSlot slotID: String) -> Int {
        manifest.records.filter { $0.slotID == slotID }.count
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
