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

/// Which piece of glass is taking the photograph.
///
/// Two physical lenses, not a zoom factor. Asking a virtual device such as
/// `.builtInDualWideCamera` for "0.5×" hands iOS the choice of which
/// constituent camera to actually use, and in poor light it will quietly
/// serve a cropped frame from the main camera instead — the picture comes
/// back with a different field of view than the one the coverage maths was
/// told about. Naming the device leaves nothing to interpret.
enum CameraLens: String, CaseIterable, Identifiable, Sendable {
    /// The ultra-wide. Worth having in a tight car park, where there is no
    /// room to step far enough back to get a whole flank in one frame.
    case ultraWide
    /// The main camera. The default, and the sharper of the two.
    case wide

    var id: String { rawValue }

    var deviceType: AVCaptureDevice.DeviceType {
        switch self {
        case .ultraWide: return .builtInUltraWideCamera
        case .wide: return .builtInWideAngleCamera
        }
    }

    /// The same two spellings the iPhone camera uses: bare when it is one of
    /// the choices, with the multiplication sign when it is the one in use.
    func label(selected: Bool) -> String {
        switch self {
        case .ultraWide: return selected ? "0.5×" : ".5"
        case .wide: return selected ? "1×" : "1"
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
    private var input: AVCaptureDeviceInput?
    /// Which lenses this phone actually has, in the order they are offered.
    /// Read once, after `configure()` returns.
    private(set) var availableLenses: [CameraLens] = []
    private(set) var lens: CameraLens = .wide
    /// The lens's real horizontal field of view, which decides how much of
    /// the car one photograph can be said to document. Read from the device
    /// rather than assumed: it differs between the wide and ultra-wide, and
    /// guessing would quietly skew every coverage calculation.
    private(set) var horizontalFieldOfView: Double = 55
    /// AVFoundation holds its capture delegates weakly, so they have to live
    /// here until the photo comes back.
    private var inFlight: [Int64: PhotoCaptureDelegate] = [:]

    /// Whether the lamp is lit.
    ///
    /// ⚠️ The torch belongs to the *device*, not to the session, so it is
    /// re-applied after every lens change — swapping the input drops it, and
    /// a button that says the light is on while the car is dark is worse
    /// than no button.
    private(set) var isTorchOn = false
    private var wantsTorch = false

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

        let discovered = AVCaptureDevice.DiscoverySession(
            deviceTypes: [CameraLens.ultraWide.deviceType, CameraLens.wide.deviceType],
            mediaType: .video,
            position: .back
        ).devices
        availableLenses = CameraLens.allCases.filter { lens in
            discovered.contains { $0.deviceType == lens.deviceType }
        }
        guard !availableLenses.isEmpty else { throw CameraError.noCamera }

        guard session.canAddOutput(output) else { throw CameraError.cannotAddOutput }
        session.addOutput(output)

        // The main camera unless this phone somehow has only the other one.
        try attachOnQueue(availableLenses.contains(.wide) ? .wide : availableLenses[0])
    }

    /// Swaps which lens feeds the session.
    ///
    /// Returns the new field of view, because the coverage arithmetic is
    /// wrong from the instant it is out of step with the glass — the caller
    /// is expected to hand it straight to the coverage tracker.
    @discardableResult
    func select(_ lens: CameraLens) async throws -> Double {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double, Error>) in
            sessionQueue.async {
                guard lens != self.lens, self.availableLenses.contains(lens) else {
                    continuation.resume(returning: self.horizontalFieldOfView)
                    return
                }
                self.session.beginConfiguration()
                do {
                    try self.attachOnQueue(lens)
                    self.session.commitConfiguration()
                    continuation.resume(returning: self.horizontalFieldOfView)
                } catch {
                    self.session.commitConfiguration()
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Must be called inside a configuration transaction.
    private func attachOnQueue(_ lens: CameraLens) throws {
        guard let camera = AVCaptureDevice.default(lens.deviceType, for: .video, position: .back) else {
            throw CameraError.noCamera
        }

        let previous = input
        if let previous { session.removeInput(previous) }

        let next: AVCaptureDeviceInput
        do {
            next = try AVCaptureDeviceInput(device: camera)
            guard session.canAddInput(next) else { throw CameraError.cannotAddInput }
        } catch {
            // Put the old lens back rather than leaving the session with no
            // camera at all. A lens that will not attach is an annoyance; a
            // dead viewfinder halfway round a car is a lost walk-around.
            if let previous, session.canAddInput(previous) {
                session.addInput(previous)
            }
            throw error
        }

        session.addInput(next)
        input = next
        device = camera
        self.lens = lens
        horizontalFieldOfView = Self.screenHorizontalFieldOfView(of: camera.activeFormat)
        applyOutputPolicy(for: camera)
        applyTorchOnQueue()
    }

    // MARK: - The lamp

    /// Lights or douses the torch, and reports what actually happened.
    ///
    /// The hardware refuses when the phone is too hot, so the answer is read
    /// back from the device rather than assumed from the request.
    @discardableResult
    func setTorch(_ on: Bool) async -> Bool {
        await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            sessionQueue.async {
                self.wantsTorch = on
                self.applyTorchOnQueue()
                continuation.resume(returning: self.isTorchOn)
            }
        }
    }

    private func applyTorchOnQueue() {
        guard let device, device.hasTorch else {
            isTorchOn = false
            return
        }
        guard (try? device.lockForConfiguration()) != nil else {
            isTorchOn = false
            return
        }
        defer { device.unlockForConfiguration() }

        if wantsTorch, device.isTorchAvailable {
            // `setTorchModeOn(level:)` rather than `torchMode = .on`: the
            // level form is the one that reports failure instead of quietly
            // doing nothing.
            try? device.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel)
        } else {
            device.torchMode = .off
        }
        isTorchOn = device.torchMode == .on
    }

    /// ⚠️ Re-applied after every lens change, not just at startup.
    ///
    /// These belong to the *session configuration*, and iOS restores their
    /// defaults when that configuration changes. Setting them once in
    /// `configure()` and swapping the input later would quietly turn deferred
    /// photo delivery back on partway through a walk-around, and a deferred
    /// proxy is not a photograph. What is supported differs per lens as well:
    /// the ultra-wide does not offer zero shutter lag on every model, and its
    /// largest photo is nowhere near the main camera's.
    private func applyOutputPolicy(for camera: AVCaptureDevice) {
        if output.isAutoDeferredPhotoDeliverySupported {
            output.isAutoDeferredPhotoDeliveryEnabled = false
        }
        output.isZeroShutterLagEnabled = output.isZeroShutterLagSupported
        output.maxPhotoQualityPrioritization = .quality
        if let largest = camera.activeFormat.supportedMaxPhotoDimensions.max(by: { $0.width < $1.width }) {
            output.maxPhotoDimensions = largest
        }
    }

    /// The field of view across the screen, which is the angle the coverage
    /// maths means by horizontal. See `CoverageProjection` for why the
    /// figure AVFoundation hands over is not that angle.
    private static func screenHorizontalFieldOfView(of format: AVCaptureDevice.Format) -> Double {
        let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
        return CoverageProjection.portraitFieldOfView(
            alongLongEdge: Double(format.videoFieldOfView),
            edges: Double(dimensions.width),
            Double(dimensions.height)
        )
    }

    /// Focuses and meters on a point the photographer tapped, given in the
    /// preview layer's normalised capture-device coordinates.
    ///
    /// Deliberately silent on failure: focus is a convenience, and a device
    /// that will not take the request still takes photographs.
    func focus(at point: CGPoint) {
        sessionQueue.async {
            guard let device = self.device else { return }
            guard (try? device.lockForConfiguration()) != nil else { return }
            defer { device.unlockForConfiguration() }

            if device.isFocusPointOfInterestSupported, device.isFocusModeSupported(.autoFocus) {
                device.focusPointOfInterest = point
                device.focusMode = .autoFocus
            }
            if device.isExposurePointOfInterestSupported, device.isExposureModeSupported(.autoExpose) {
                device.exposurePointOfInterest = point
                device.exposureMode = .autoExpose
            }
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
                // Doused before the session goes down, not after: once the
                // session stops, device configuration no longer sticks, and
                // a torch left burning in somebody's pocket is a hot phone
                // and a flat battery.
                self.wantsTorch = false
                self.applyTorchOnQueue()
                if self.session.isRunning { self.session.stopRunning() }
                continuation.resume()
            }
        }
    }

    /// Takes one photograph and returns the file bytes, with `stamp`'s facts
    /// written in by AVFoundation as it flattens the photo — so the file is
    /// complete the first time and is never rewritten.
    func capturePhoto(stamp: CaptureStamp) async throws -> Data {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
            sessionQueue.async {
                guard self.device != nil else {
                    continuation.resume(throwing: CameraError.notConfigured)
                    return
                }

                let settings = self.makeSettings()
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

    private func makeSettings() -> AVCapturePhotoSettings {
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
        // ⚠️ Never the flash. Light comes from the torch instead, which is
        // already on and already metered for, and the difference is not only
        // the pre-flash delay: **asking for flash switches zero shutter lag
        // off**, and zero shutter lag is what was removing a chunk of the
        // motion blur the quality gate would otherwise reject. Trading it
        // for a brighter, later frame is the wrong way round for an app
        // whose whole problem is blurred photographs.
        settings.flashMode = .off
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
        return "Walkaround \(version) (\(build))"
    }
}
