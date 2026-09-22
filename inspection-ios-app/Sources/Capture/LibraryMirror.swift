import CoreLocation
import EvidenceCore
import Photos

enum PhotoLibraryError: LocalizedError {
    case notAuthorised
    case saveFailed(String)

    var errorDescription: String? {
        switch self {
        case .notAuthorised:
            return "需要相册权限才能把照片交给 Turo App。到「设置 → Walkaround → 照片」里打开。"
        case .saveFailed(let reason):
            return "存进相册失败：\(reason)"
        }
    }
}

/// What came back out of the library when the files were read again.
struct PhotoLibraryExportResult: Sendable {
    var albumTitle: String
    /// Files whose bytes came back out of the library byte-for-byte identical.
    var intact: [String]
    /// Files the library handed back different from what went in. Any entry
    /// here means the photo library is not a safe delivery channel on this
    /// device, and somebody needs to know before a claim does.
    var altered: [String]
    /// Files that went in but could not be read back to check.
    var unverified: [String]

    var isLossless: Bool { altered.isEmpty && unverified.isEmpty }
}

/// Copies every photograph into the camera roll **as it is taken**.
///
/// ⚠️ This used to happen once, at the end, from the finish page. That was
/// wrong in the way that only shows up on a bad day: a walk-around that never
/// reaches the finish page — a flat battery, a guest who turns up early, a
/// phone that goes back in a pocket — left every photograph inside this app's
/// container, where Turo's uploader cannot see it. The work was done and the
/// evidence was unreachable.
///
/// **The library copy is a delivery channel, not the archive.** The archive
/// stays in the app's own container: read-only, hashed, with a manifest. This
/// exists because claims are filed from the Turo app, whose picker reads the
/// photo library and nothing else.
///
/// Which is why the bytes are read back and re-hashed. `addResource(with:
/// data:)` is documented to store what it is given, but "documented" and
/// "measured on this phone, this iOS version" are different things, and the
/// failure mode is silent: a re-encoded copy can keep its EXIF and still
/// break every digest in the manifest. The **first** photograph of a session
/// is checked immediately, as a canary — if this phone re-encodes, it does it
/// to all of them, and finding that out on photograph one is worth far more
/// than finding it out on photograph forty-one.
@MainActor
@Observable
final class LibraryMirror {

    enum Verdict: Equatable {
        case unknown
        /// Read back byte-for-byte identical. The library is safe here.
        case intact
        /// The library handed back something else. Do not deliver this way.
        case altered
    }

    private(set) var status: PHAuthorizationStatus = .notDetermined
    private(set) var saved = 0
    private(set) var failed = 0
    private(set) var verdict: Verdict = .unknown
    /// The last thing that went wrong, for the chip on the camera screen. A
    /// photograph that quietly did not reach the camera roll is the failure
    /// this whole class exists to prevent, so it is never swallowed.
    private(set) var lastError: String?

    /// ⚠️ The canary is read back once and only once. Without this, a phone
    /// that cannot read its own library back (limited access) would pull a
    /// three-megabyte asset off disk after every single shutter press,
    /// looking for an answer it is never going to get.
    private var canaryDone = false
    private var albumIdentifier: String?
    private var albumTitle = ""
    /// Saves run one at a time and off the shutter's path — pressing the
    /// button again must never wait for Photos.
    private var queue: Task<Void, Never>?

    var isWriteable: Bool { status == .authorized || status == .limited }

    /// Whether anything needs saying on the camera screen.
    var trouble: String? {
        if status == .denied || status == .restricted {
            return "照片没有存进相册 —— 到设置里打开相册权限"
        }
        if verdict == .altered {
            return "这台手机的相册会重新编码照片 —— 别从相册交 Turo"
        }
        return lastError
    }

    /// Asked once, when the camera screen opens, so the prompt never lands
    /// between somebody and a photograph they are trying to take.
    ///
    /// ⚠️ `.readWrite` rather than `.addOnly`, and the extra access buys one
    /// specific thing: reading the bytes back. Add-only can put a file in and
    /// can never tell you what happened to it, and "we saved it" without
    /// "and it is still the same file" is exactly the claim this app is not
    /// allowed to make.
    func authorise() async {
        status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .notDetermined else { return }
        status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
    }

    /// Hands one photograph to the library. Returns immediately.
    func mirror(_ jpeg: Data, as record: CaptureRecord, into archive: SessionArchive, sessionStart: Date) {
        guard isWriteable else { return }
        let previous = queue
        queue = Task { [weak self] in
            await previous?.value
            await self?.perform(jpeg, record, archive, sessionStart)
        }
    }

    /// Waits for everything queued so far. Used by the finish page, which
    /// must not report on a library that is still being written to.
    func settle() async { await queue?.value }

    private func perform(
        _ jpeg: Data, _ record: CaptureRecord, _ archive: SessionArchive, _ sessionStart: Date
    ) async {
        do {
            let album = try? await ensureAlbum(titled: Self.workingTitle(for: sessionStart))
            let identifier = try await add(jpeg, record: record, to: album)
            try? await archive.noteLibraryAsset(identifier, forFilename: record.filename)
            saved += 1
            lastError = nil
            // The canary. One read-back at the start of a session, not forty.
            if !canaryDone {
                canaryDone = true
                verdict = await verify(identifier, against: record.sha256) ?? .unknown
            }
        } catch {
            failed += 1
            lastError = "有 \(failed) 张没存进相册：\((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)"
        }
    }

    private func add(_ jpeg: Data, record: CaptureRecord, to album: PHAssetCollection?) async throws -> String {
        var placeholder: PHObjectPlaceholder?
        do {
            try await PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                options.originalFilename = record.filename
                // ⚠️ `.photo` with the file data stores the bytes as handed
                // over. Going via a UIImage would re-encode, which is the
                // whole thing this app exists to avoid.
                request.addResource(with: .photo, data: jpeg, options: options)
                // Photos reads this out of the EXIF as well; setting it
                // explicitly is what keeps the album in shooting order even
                // if a phone's import does something unexpected.
                request.creationDate = record.capturedAt
                if let album,
                   let created = request.placeholderForCreatedAsset,
                   let albumRequest = PHAssetCollectionChangeRequest(for: album) {
                    albumRequest.addAssets([created] as NSArray)
                }
                placeholder = request.placeholderForCreatedAsset
            }
        } catch {
            throw PhotoLibraryError.saveFailed(error.localizedDescription)
        }
        guard let identifier = placeholder?.localIdentifier else {
            throw PhotoLibraryError.saveFailed("相册没有返回这张照片的标识")
        }
        return identifier
    }

    // MARK: - The album

    /// ⚠️ Created on the first photograph, named after the clock, and renamed
    /// at the finish page once the plate is known. The name cannot be right
    /// at the start: nobody has said which car this is, and this app refuses
    /// to ask before the first photograph. A folder called「9月21日 15:04」is
    /// findable; a folder called「未命名」is not.
    private func ensureAlbum(titled title: String) async throws -> PHAssetCollection {
        if let albumIdentifier,
           let existing = PHAssetCollection.fetchAssetCollections(
               withLocalIdentifiers: [albumIdentifier], options: nil).firstObject {
            return existing
        }
        var placeholder: PHObjectPlaceholder?
        try await PHPhotoLibrary.shared().performChanges {
            placeholder = PHAssetCollectionChangeRequest
                .creationRequestForAssetCollection(withTitle: title)
                .placeholderForCreatedAssetCollection
        }
        guard let identifier = placeholder?.localIdentifier,
              let album = PHAssetCollection.fetchAssetCollections(
                  withLocalIdentifiers: [identifier], options: nil).firstObject else {
            throw PhotoLibraryError.saveFailed("建不了相簿")
        }
        albumIdentifier = identifier
        albumTitle = title
        return album
    }

    private func rename(to title: String) async {
        guard let albumIdentifier,
              let album = PHAssetCollection.fetchAssetCollections(
                  withLocalIdentifiers: [albumIdentifier], options: nil).firstObject else { return }
        try? await PHPhotoLibrary.shared().performChanges {
            PHAssetCollectionChangeRequest(for: album)?.title = title
        }
        albumTitle = title
    }

    private static func workingTitle(for start: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_Hans")
        formatter.dateFormat = "M月d日 HH:mm"
        return "Walkaround \(formatter.string(from: start))"
    }

    /// Named so it can be found in the Turo app's picker without scrolling
    /// through a camera roll.
    private static func finalTitle(for manifest: SessionManifest) -> String {
        guard !manifest.vehicleLabel.isEmpty else { return workingTitle(for: manifest.startedAt) }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_Hans")
        formatter.dateFormat = "M月d日"
        let occasion = manifest.kind == .checkout ? "交车" : "还车"
        return "\(manifest.vehicleLabel) \(occasion) \(formatter.string(from: manifest.startedAt))"
    }

    // MARK: - Finishing

    /// Tops up anything the live mirror missed, names the album after the
    /// car, and then checks every file by reading it back.
    ///
    /// ⚠️ Tops up rather than saves again. Saving a session that is already
    /// in the library would put forty-one duplicates in the camera roll, and
    /// somebody would then attach the wrong half of them to a claim.
    func finish(archive: SessionArchive, manifest: SessionManifest) async throws -> PhotoLibraryExportResult {
        await authorise()
        guard isWriteable else { throw PhotoLibraryError.notAuthorised }
        await settle()

        let missing = manifest.recordsNotInLibrary
        if !missing.isEmpty {
            let album = try? await ensureAlbum(titled: Self.workingTitle(for: manifest.startedAt))
            for record in missing {
                guard let data = try? Data(contentsOf: archive.url(of: record)) else { continue }
                if let identifier = try? await add(data, record: record, to: album) {
                    try? await archive.noteLibraryAsset(identifier, forFilename: record.filename)
                    saved += 1
                }
            }
        }

        await rename(to: Self.finalTitle(for: manifest))
        let current = await archive.manifest
        return await verifyAll(current, albumTitle: albumTitle)
    }

    private func verifyAll(_ manifest: SessionManifest, albumTitle: String) async -> PhotoLibraryExportResult {
        var intact: [String] = []
        var altered: [String] = []
        var unverified: [String] = []

        for record in manifest.records {
            guard let identifier = record.libraryAssetID else {
                unverified.append(record.filename)
                continue
            }
            switch await verify(identifier, against: record.sha256) {
            case .intact: intact.append(record.filename)
            case .altered: altered.append(record.filename)
            case .unknown, nil: unverified.append(record.filename)
            }
        }

        if !altered.isEmpty { verdict = .altered }
        return PhotoLibraryExportResult(
            albumTitle: albumTitle,
            intact: intact.sorted(), altered: altered.sorted(), unverified: unverified.sorted()
        )
    }

    /// Pulls one asset's original resource back out and re-hashes it.
    private func verify(_ identifier: String, against digest: String) async -> Verdict? {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil).firstObject,
              let resource = PHAssetResource.assetResources(for: asset).first(where: { $0.type == .photo }),
              let data = await Self.data(of: resource) else { return nil }
        return EvidenceHash.matches(data, digest: digest) ? .intact : .altered
    }

    private static func data(of resource: PHAssetResource) async -> Data? {
        await withCheckedContinuation { continuation in
            let options = PHAssetResourceRequestOptions()
            options.isNetworkAccessAllowed = true
            var buffer = Data()
            PHAssetResourceManager.default().requestData(for: resource, options: options) { chunk in
                buffer.append(chunk)
            } completionHandler: { error in
                continuation.resume(returning: error == nil ? buffer : nil)
            }
        }
    }
}
