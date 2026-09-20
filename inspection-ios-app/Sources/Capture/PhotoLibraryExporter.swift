import EvidenceCore
import Photos

enum PhotoLibraryExportError: LocalizedError {
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

/// Copies the finished session into the photo library, grouped into an album,
/// and then checks what came back out.
///
/// **The library copy is a delivery channel, not the archive.** The archive
/// stays in the app's own container: read-only, hashed, with a manifest. This
/// exists because claims are filed from the Turo app, whose picker reads the
/// photo library and nothing else — so the photographs have to be there, and
/// the only question worth answering is whether they survive the trip.
///
/// Which is why every file is read back and re-hashed. `addResource(with:
/// data:)` is documented to store the bytes as given, but "documented" and
/// "measured on this phone, this iOS version" are different things, and the
/// failure mode is silent: a re-encoded copy can keep its EXIF and still
/// break every digest in the manifest.
@MainActor
final class PhotoLibraryExporter {

    func export(from archive: SessionArchive, manifest: SessionManifest) async throws -> PhotoLibraryExportResult {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard status == .authorized || status == .limited else {
            throw PhotoLibraryExportError.notAuthorised
        }

        let title = Self.albumTitle(for: manifest)
        let records = manifest.acceptedRecords

        var identifiers: [String: CaptureRecord] = [:]
        do {
            try await PHPhotoLibrary.shared().performChanges {
                let album = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: title)
                for record in records {
                    guard let data = try? Data(contentsOf: archive.url(of: record)) else { continue }
                    let request = PHAssetCreationRequest.forAsset()
                    let options = PHAssetResourceCreationOptions()
                    options.originalFilename = record.filename
                    // `.photo` with the file data stores the bytes as handed
                    // over. Going via a UIImage would re-encode, which is the
                    // whole thing we are avoiding.
                    request.addResource(with: .photo, data: data, options: options)
                    if let placeholder = request.placeholderForCreatedAsset {
                        identifiers[placeholder.localIdentifier] = record
                        album.addAssets([placeholder] as NSArray)
                    }
                }
            }
        } catch {
            throw PhotoLibraryExportError.saveFailed(error.localizedDescription)
        }

        return await verify(identifiers, albumTitle: title)
    }

    /// Pulls each asset's original resource back out and re-hashes it.
    private func verify(_ identifiers: [String: CaptureRecord], albumTitle: String) async -> PhotoLibraryExportResult {
        var intact: [String] = []
        var altered: [String] = []
        var unverified: [String] = []

        let assets = PHAsset.fetchAssets(withLocalIdentifiers: Array(identifiers.keys), options: nil)
        var found: [String: PHAsset] = [:]
        assets.enumerateObjects { asset, _, _ in found[asset.localIdentifier] = asset }

        for (identifier, record) in identifiers {
            guard let asset = found[identifier],
                  let resource = PHAssetResource.assetResources(for: asset).first(where: { $0.type == .photo }),
                  let data = await Self.data(of: resource) else {
                unverified.append(record.filename)
                continue
            }
            if EvidenceHash.matches(data, digest: record.sha256) {
                intact.append(record.filename)
            } else {
                altered.append(record.filename)
            }
        }

        return PhotoLibraryExportResult(
            albumTitle: albumTitle,
            intact: intact.sorted(),
            altered: altered.sorted(),
            unverified: unverified.sorted()
        )
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

    /// Named so it can be found in the Turo app's picker without scrolling
    /// through a camera roll.
    private static func albumTitle(for manifest: SessionManifest) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_Hans")
        formatter.dateFormat = "M月d日"
        let occasion = manifest.kind == .checkout ? "交车" : "还车"
        return "\(manifest.vehicleLabel) \(occasion) \(formatter.string(from: manifest.startedAt))"
    }
}
