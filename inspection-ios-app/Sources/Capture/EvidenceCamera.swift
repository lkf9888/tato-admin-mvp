import AVFoundation
import EvidenceCore
import Foundation

/// Written to be read by whoever is standing next to the car, not by whoever
/// wrote the app. A staff member who sees "noCamera" learns nothing they can
/// act on.
enum CameraError: LocalizedError {
    case noCamera
    case cannotAddInput
    case cannotAddOutput
    case captureProducedNothing
    case notConfigured

    var errorDescription: String? {
        switch self {
        case .noCamera:
            return "这台设备上找不到后置摄像头。"
        case .cannotAddInput, .cannotAddOutput, .notConfigured:
            return "相机没能启动。退出重进一次，还是不行就重启手机。"
        case .captureProducedNothing:
            return "这一张没有拍成，再按一次快门。"
        }
    }
}

/// The camera, configured so that what comes out is a file we can stand
/// behind in a claim.
///
/// Three settings here are not preferences — getting any of them wrong
/// quietly ruins the evidence:
///
/// 1. **Deferred photo delivery is switched off.** iOS 17 and later will
///    otherwise hand back an `AVCaptureDeferredPhotoProxy`: a placeholder
///    whose real processing happens later, inside the photo library. It
///    flattens to something that looks like a photograph and is not the
///    finished capture. For an evidence app that is unusable.
/// 2. **JPEG, not HEIC.** Not for quality — because the file goes to an
///    insurer's web uploader, and converting a HEIC afterwards would mean
///    re-encoding, which is the one thing that must never happen. Asking the
///    camera for JPEG up front costs nothing: the pipeline produces it
///    directly rather than transcoding.
/// 3. **Zero shutter lag stays on.** It captures from a rolling buffer, so
///    the frame can pre-date the button press by a fraction of a second. That
///    is fine — EXIF records when the frame was taken — and it removes a
///    chunk of the motion blur that the quality gate would otherwise reject.
///
/// `@unchecked Sendable` is deliberate: `AVCaptureSession` is not Sendable and
/// never will be, so every mutation funnels through `sessionQueue` instead.
/// The only thing handed out across threads is `session` itself, read-only,
/// for the preview layer to attach to.
final class EvidenceCamera: NSObject, @unchecked Sendable {

    let session = AVCaptureSession()

    private let sessionQueue = DispatchQueue(label: "co.tatocar.evidence.camera")
    private let output = AVCapturePhotoOutput()
    private var device: AVCaptureDevice?
    /// AVFoundation holds its capture delegates weakly, so they have to live
    /// here until the photo comes back.
    private var inFlight: [Int64: PhotoCaptureDelegate] = [:]

    func configure() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            sessionQueue.async {
                do {
                    try self.configureOnQueue()
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func configureOnQueue() throws {
        session.beginConfiguration()
        defer { session.commitConfiguration() }

        session.sessionPreset = .photo

        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            throw CameraError.noCamera
        }
        device = camera

        let input = try AVCaptureDeviceInput(device: camera)
        guard session.canAddInput(input) else { throw CameraError.cannotAddInput }
        session.addInput(input)

        guard session.canAddOutput(output) else { throw CameraError.cannotAddOutput }
        session.addOutput(output)

        // ⚠️ See the type comment. A proxy is not a photograph.
        if output.isAutoDeferredPhotoDeliverySupported {
            output.isAutoDeferredPhotoDeliveryEnabled = false
        }
        if output.isZeroShutterLagSupported {
            output.isZeroShutterLagEnabled = true
        }
        output.maxPhotoQualityPrioritization = .quality
        if let largest = camera.activeFormat.supportedMaxPhotoDimensions.max(by: { $0.width < $1.width }) {
            output.maxPhotoDimensions = largest
        }
    }

    func start() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            sessionQueue.async {
                if !self.session.isRunning { self.session.startRunning() }
                continuation.resume()
            }
        }
    }

    func stop() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            sessionQueue.async {
                if self.session.isRunning { self.session.stopRunning() }
                continuation.resume()
            }
        }
    }

    /// Takes one photograph and returns the file bytes, with `stamp`'s facts
    /// written in by AVFoundation as it flattens the photo — so the file is
    /// complete the first time and is never rewritten.
    func capturePhoto(stamp: CaptureStamp, flash: AVCaptureDevice.FlashMode) async throws -> Data {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
            sessionQueue.async {
                guard self.device != nil else {
                    continuation.resume(throwing: CameraError.notConfigured)
                    return
                }

                let settings = self.makeSettings(flash: flash)
                // Captured as a plain Int64 so the closure does not hold the
                // settings object itself across threads.
                let uniqueID = settings.uniqueID
                let delegate = PhotoCaptureDelegate(
                    customizer: MetadataCustomizer(stamp: stamp),
                    completion: { [weak self] result in
                        guard let self else { return }
                        self.sessionQueue.async { self.inFlight[uniqueID] = nil }
                        continuation.resume(with: result)
                    }
                )
                self.inFlight[uniqueID] = delegate
                self.output.capturePhoto(with: settings, delegate: delegate)
            }
        }
    }

    private func makeSettings(flash: AVCaptureDevice.FlashMode) -> AVCapturePhotoSettings {
        let settings: AVCapturePhotoSettings
        if output.availablePhotoCodecTypes.contains(.jpeg) {
            settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
        } else {
            // Should not happen on any supported iPhone. If it ever does, the
            // container type is recorded per file and the gate will notice.
            settings = AVCapturePhotoSettings()
        }
        settings.photoQualityPrioritization = .quality
        settings.maxPhotoDimensions = output.maxPhotoDimensions
        if output.supportedFlashModes.contains(flash) {
            settings.flashMode = flash
        }
        return settings
    }
}

/// Hands AVFoundation the metadata to write while it builds the file.
///
/// `replacementMetadata(for:)` is called synchronously, before flattening
/// starts, which is what makes this a write rather than a rewrite.
private final class MetadataCustomizer: NSObject, AVCapturePhotoFileDataRepresentationCustomizer {
    private let stamp: CaptureStamp

    init(stamp: CaptureStamp) {
        self.stamp = stamp
    }

    func replacementMetadata(for photo: AVCapturePhoto) -> [String: Any]? {
        CaptureMetadata.replacement(for: photo.metadata, with: stamp)
    }
}

private final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    private let customizer: MetadataCustomizer
    private let completion: (Result<Data, Error>) -> Void

    init(customizer: MetadataCustomizer, completion: @escaping (Result<Data, Error>) -> Void) {
        self.customizer = customizer
        self.completion = completion
    }

    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        if let error {
            completion(.failure(error))
            return
        }
        guard let data = photo.fileDataRepresentation(with: customizer) else {
            completion(.failure(CameraError.captureProducedNothing))
            return
        }
        completion(.success(data))
    }
}

/// The raw hardware identifier, e.g. `iPhone17,1`.
///
/// Only ever a fallback: AVFoundation writes its own, friendlier `Model` into
/// the EXIF and `CaptureMetadata` will not displace it. This is what gets
/// written if some future capture path does not.
enum DeviceIdentity {
    static var machine: String {
        var info = utsname()
        guard uname(&info) == 0 else { return "unknown" }
        // Read through a Mirror rather than by rebinding a pointer into the
        // struct: the pointer form trips Swift's exclusivity checking, and
        // this runs once per session anyway.
        let characters = Mirror(reflecting: info.machine).children
            .compactMap { $0.value as? CChar }
            .prefix { $0 != 0 }
            .map { UInt8(bitPattern: $0) }
        let identifier = String(decoding: characters, as: UTF8.self)
        return identifier.isEmpty ? "unknown" : identifier
    }

    static var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        return "TATO Evidence \(version) (\(build))"
    }
}
