import EvidenceCore
import Foundation

/// Finds sessions on disk, and answers "is this file one of ours".
enum ArchiveIndex {

    static func sessionsDirectory() throws -> URL {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        return support.appendingPathComponent("sessions", isDirectory: true)
    }

    static func sessionURLs() -> [URL] {
        guard let root = try? sessionsDirectory(),
              let contents = try? FileManager.default.contentsOfDirectory(
                  at: root, includingPropertiesForKeys: nil
              ) else { return [] }
        return contents.filter { $0.hasDirectoryPath }.sorted { $0.lastPathComponent > $1.lastPathComponent }
    }

    static func manifests() -> [SessionManifest] {
        sessionURLs().compactMap { url in
            guard let data = try? Data(contentsOf: url.appendingPathComponent("manifest.json")) else { return nil }
            return try? JSONDecoder.evidence.decode(SessionManifest.self, from: data)
        }
    }

    /// Works out what a file is, across every session on the phone.
    ///
    /// This is what makes the path check conclusive rather than suggestive:
    /// "the metadata looks fine" can be true of a re-encoded copy, but a
    /// digest that matches an archived original can only be the original.
    static func provenance(ofDigest digest: String, capturedAt: Date?) -> Provenance {
        for manifest in manifests() {
            let result = manifest.provenance(ofDigest: digest, capturedAt: capturedAt)
            if result != .unknown { return result }
        }
        return .unknown
    }
}
