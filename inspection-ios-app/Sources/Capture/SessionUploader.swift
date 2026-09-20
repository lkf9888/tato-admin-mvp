import EvidenceCore
import Foundation

/// Sends a finished walk-around to the fleet's backend, one photograph at a
/// time.
///
/// One request per shot rather than one for the batch. A walk-around is two
/// dozen full-resolution photographs going out over a car park's mobile
/// signal; batched, a single dropped connection costs the lot. Per-shot, a
/// retry picks up where it stopped, and the server is idempotent on (slot,
/// attempt) so a shot that did land before the connection died is not an
/// error the second time.
@MainActor
@Observable
final class SessionUploader {

    enum State: Equatable {
        case idle
        case working(done: Int, total: Int)
        case finished(CompletionSummary)
        case failed(String)
    }

    struct CompletionSummary: Equatable {
        var uploaded: Int
        var missingLocation: [String]
        var qualityOverridden: [String]
        var suspectClock: [String]

        var isClean: Bool {
            missingLocation.isEmpty && qualityOverridden.isEmpty && suspectClock.isEmpty
        }
    }

    private(set) var state: State = .idle

    private let settings: ServerSettings
    /// Slots already sent in this run, so a retry after a mid-way failure does
    /// not re-send megabytes the server already has.
    private var sent: Set<String> = []

    init(settings: ServerSettings) {
        self.settings = settings
    }

    func upload(archive: SessionArchive, manifest: SessionManifest) async {
        guard let baseURL = settings.endpoint, !settings.staffCode.isEmpty else {
            state = .failed(UploadError.notConfigured.errorDescription ?? "")
            return
        }

        do {
            let token = try await currentToken(baseURL: baseURL)
            let client = UploadClient(baseURL: baseURL, token: token)
            let records = manifest.acceptedRecords

            state = .working(done: 0, total: records.count)
            let sessionID = try await client.openSession(manifest)

            for (index, record) in records.enumerated() {
                state = .working(done: index, total: records.count)
                guard !sent.contains(record.id) else { continue }
                let jpeg = try Data(contentsOf: archive.url(of: record))
                _ = try await client.uploadShot(sessionID: sessionID, record: record, jpeg: jpeg)
                sent.insert(record.id)
            }

            let completion = try await client.complete(sessionID: sessionID)
            state = .finished(CompletionSummary(
                uploaded: records.count,
                missingLocation: completion.missingLocation,
                qualityOverridden: completion.qualityOverridden,
                suspectClock: completion.suspectClock
            ))
        } catch {
            state = .failed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
        }
    }

    /// Signs in on first use, and again when a stored token has expired.
    private func currentToken(baseURL: URL) async throws -> String {
        if let token = settings.token, !token.isEmpty { return token }
        let token = try await UploadClient.signIn(baseURL: baseURL, staffCode: settings.staffCode)
        settings.token = token
        return token
    }

    func signOut() {
        settings.token = nil
        sent.removeAll()
        state = .idle
    }
}
