import EvidenceCore
import Foundation

enum UploadError: LocalizedError {
    case notConfigured
    case signInFailed
    case server(status: Int, code: String, detail: String?)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "还没设置服务器地址和工号。"
        case .signInFailed:
            return "工号登录失败，检查一下工号和服务器地址。"
        case .transport(let message):
            return "连不上服务器：\(message)"
        case .server(_, let code, let detail):
            return Self.explain(code, detail)
        }
    }

    /// The server's error codes, said in a way that tells the person in the
    /// car park what to do next.
    private static func explain(_ code: String, _ detail: String?) -> String {
        switch code {
        case "DIGEST_MISMATCH":
            return "照片在上传途中变了，重传一次。反复出现说明网络有问题，换个网络。"
        case "NOT_A_JPEG":
            return "这个文件不是 JPEG，不该发生，请把这台手机的型号报给管理员。"
        case "NO_CAPTURE_TIME":
            return "这张照片没有拍摄时间，不能作为证据。重拍一张。"
        case "SLOT_CONFLICT":
            return "后台这一格已经有另一张照片了。\(detail ?? "")"
        case "SESSION_ALREADY_COMPLETE":
            return "这一单已经交过了，不能再加照片。"
        case "SHOTS_OUTSTANDING":
            return "还有照片没拍完，拍齐了才能交。"
        case "UNAUTHORIZED":
            return "登录过期了，重新用工号登录。"
        default:
            return "服务器拒绝了：\(code)\(detail.map { "（\($0)）" } ?? "")"
        }
    }
}

struct ShotUploadResult: Sendable {
    let gaps: [EvidenceGap]
    let clockSuspect: Bool
    let duplicate: Bool
}

struct CompletionResult: Sendable {
    let missingLocation: [String]
    let takenOffStation: [String]
    let qualityOverridden: [String]
    let suspectClock: [String]
}

/// Talks to the fleet's own backend.
///
/// Everything sent here is also sent to the photo library for the Turo app,
/// and the two serve different purposes: the library copy is how a claim gets
/// filed today, and this is the copy that outlives the phone. A staff member
/// who drops their iPhone in a lake has still delivered the evidence.
///
/// The server re-derives the digest and the metadata from the bytes it
/// receives and will reject what does not add up, so a successful upload is a
/// second, independent confirmation that the file is intact — not merely that
/// it was transmitted.
struct UploadClient: Sendable {
    let baseURL: URL
    let token: String

    static func signIn(baseURL: URL, staffCode: String) async throws -> String {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/staff-app/login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["staffCode": staffCode])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = payload["token"] as? String else {
            throw UploadError.signInFailed
        }
        return token
    }

    func openSession(_ manifest: SessionManifest) async throws -> String {
        let body: [String: Any] = [
            "clientSessionId": manifest.sessionID,
            "vehicleLabel": manifest.vehicleLabel,
            "kind": manifest.kind.rawValue,
            "deviceModel": manifest.deviceModel,
            "appVersion": manifest.appVersion,
            "startedAt": ISO8601DateFormatter().string(from: manifest.startedAt),
            "timeZone": manifest.timeZoneIdentifier,
            "coverageFraction": manifest.coverage.fraction,
            "exteriorShots": manifest.exteriorShots,
            "interiorShots": manifest.interiorShots,
        ]
        let payload = try await send(
            path: "api/inspection/sessions",
            body: try JSONSerialization.data(withJSONObject: body),
        )
        guard let sessionID = payload["sessionId"] as? String else {
            throw UploadError.server(status: 200, code: "NO_SESSION_ID", detail: nil)
        }
        return sessionID
    }

    func uploadShot(
        sessionID: String,
        record: CaptureRecord,
        jpeg: Data,
    ) async throws -> ShotUploadResult {
        let meta: [String: Any] = [
            // The server keeps calling this a slot; here it is the region the
            // photograph turned out to document, which is what the review page
            // pairs handover against return on.
            "slotId": record.region.rawValue,
            "attempt": record.sequence,
            "accepted": record.accepted,
            "sha256": record.sha256,
            "reportedSharpness": record.quality.laplacianVariance,
            "reportedIssues": record.quality.issues.map(\.rawValue),
            "acceptedDespite": record.acceptedDespite.map(\.rawValue),
            "metadataPath": record.metadataPath.rawValue,
            // Sent so the server can compare this phone's clock with its own.
            // EXIF times are only as trustworthy as the device that wrote
            // them, and a phone's clock is user-settable.
            "deviceClockAt": ISO8601DateFormatter().string(from: Date()),
        ]

        let boundary = "tato-\(UUID().uuidString)"
        var body = Data()
        func append(_ text: String) { body.append(Data(text.utf8)) }

        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"meta\"\r\n\r\n")
        body.append(try JSONSerialization.data(withJSONObject: meta))
        append("\r\n--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"file\"; filename=\"\(record.filename)\"\r\n")
        append("Content-Type: image/jpeg\r\n\r\n")
        // The archived bytes, verbatim. Nothing re-encodes them on the way
        // out, which is the entire point of the exercise.
        body.append(jpeg)
        append("\r\n--\(boundary)--\r\n")

        let payload = try await send(
            path: "api/inspection/sessions/\(sessionID)/shots",
            body: body,
            contentType: "multipart/form-data; boundary=\(boundary)",
        )

        return ShotUploadResult(
            gaps: (payload["gaps"] as? [String] ?? []).compactMap(EvidenceGap.init(rawValue:)),
            clockSuspect: payload["clockSuspect"] as? Bool ?? false,
            duplicate: payload["duplicate"] as? Bool ?? false
        )
    }

    func complete(sessionID: String) async throws -> CompletionResult {
        let payload = try await send(path: "api/inspection/sessions/\(sessionID)/complete", body: Data())
        let warnings = payload["warnings"] as? [String: Any] ?? [:]
        return CompletionResult(
            missingLocation: warnings["missingLocation"] as? [String] ?? [],
            takenOffStation: warnings["takenOffStation"] as? [String] ?? [],
            qualityOverridden: warnings["qualityOverridden"] as? [String] ?? [],
            suspectClock: warnings["suspectClock"] as? [String] ?? []
        )
    }

    private func send(
        path: String,
        body: Data,
        contentType: String = "application/json",
    ) async throws -> [String: Any] {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if !body.isEmpty { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        request.httpBody = body.isEmpty ? nil : body
        // Generous: a full-resolution photograph over a car park's mobile
        // signal is not a fast request, and giving up early would mean
        // retrying the whole thing.
        request.timeoutInterval = 120

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw UploadError.transport(error.localizedDescription)
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else {
            throw UploadError.server(
                status: status,
                code: payload["error"] as? String ?? "HTTP_\(status)",
                detail: payload["detail"] as? String
            )
        }
        return payload
    }
}
