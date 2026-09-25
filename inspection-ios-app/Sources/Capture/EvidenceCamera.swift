import AVFoundation
import CoreMedia
import EvidenceCore
import Foundation

enum CameraError: LocalizedError {
    case noCamera
    case cannotAddInput
    case cannotAddOutput
    case captureProducedNothing
    case notConfigured

    var errorDescription: String? {
        switch self {
        case .noCamera:
            return "这台手机上找不到后置摄像头。"
        case .cannotAddInput, .cannotAddOutput, .notConfigured:
            return "相机没能准备好。退出 App 再打开一次。"
        case .captureProducedNothing:
            return "这一张没有拍下来，再按一次快门。"
        }
    }
}

/// The two lenses the app offers.
///
/// There is no 2× and no pinch-to-zoom: digital zoom is a crop of the same
/// sensor, so it throws away the pixels an assessor would use to see the
/// scratch. Two real lenses, nothing in between.
enum CameraLens: String, CaseIterable, Identifiable, Sendable {
    /// 0.5× — for the inside of the car, and a car parked against a wall.
    case ultraWide
    /// 1× — the main camera, and the default.
    case wide

    var id: String { rawValue }

    var deviceType: AVCaptureDevice.DeviceType {
        switch self {
        case .ultraWide: return .builtInUltraWideCamera
        case .wide: return .builtInWideAngleCamera
        }
    }

    /// As the iPhone camera writes it: the selected lens gets the ×.
    func label(selected: Bool) -> String {
        switch self {
        case .ultraWide: return selected ? "0.5×" : ".5"
        case .wide: return selected ? "1×" : "1"
        }
    }
}

/// How big a photograph to ask the sensor for.
enum PhotoResolution: String, CaseIterable, Identifiable, Sendable {
    /// Twelve megapixels, from the full photo pipeline.
    ///
    /// ⚠️ The default, and a choice rather than a limitation. Twelve is
    /// already enough to show a scratch; forty-eight is about four times the
    /// file for every photograph, which is four times the camera roll, the
    /// upload and the server disk (the server's disk has filled up twice);
    /// each one waits longer for processing, because deferred delivery is off
    /// for evidence reasons; and in a dim car park it is noisier, because
    /// forty-eight is the sensor *not* binning pixels. iOS itself drops to
    /// twelve in low light for that reason.
    case standard
    /// The largest the lens offers — forty-eight megapixels on the phones
    /// that have it.
    case high

    var id: String { rawValue }

    static let pixelsInStandard = 12_300_000
}

/// The camera, configured so that what comes out is a file we can stand
/// behind in a claim.
///
/// ⚠️ This is the camera ARKit replaced in v0.82.0, back again. ARKit and
/// `AVCaptureSession` cannot both hold the back camera — measured on a real
/// car — and the app chose the iPhone's own photo pipeline and both lenses
/// over the LiDAR surface model. Direction now comes from the gyroscope
/// instead; see `CameraHeading`.
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
///    re-encoding, which is the one thing that must never happen.
/// 3. **Zero shutter lag stays on.** It captures from a rolling buffer, so
///    the frame can pre-date the button press by a fraction of a second. That
///    is fine — EXIF records when the frame was taken — and it removes a
///    chunk of the motion blur the quality gate would otherwise reject.
///
/// `@unchecked Sendable` is deliberate: `AVCaptureSession` is not Sendable and
/// never will be, so every mutation funnels through `sessionQueue` instead.
/// The only thing handed out across threads is `session` itself, read-only,
/// for the preview layer to attach to.
final class EvidenceCamera: NSObject, @unchecked Sendable {

    struct Photo: Sendable {
        var data: Data
        /// As the sensor delivers it — landscape. The file carries an
        /// orientation tag that turns it upright.
        var pixelWidth: Int
        var pixelHeight: Int
    }

    let session = AVCaptureSession()

    private let sessionQueue = DispatchQueue(label: "co.tatocar.evidence.camera")
    private let output = AVCapturePhotoOutput()
    private var device: AVCaptureDevice?
    private var input: AVCaptureDeviceInput?
    /// Which lenses this phone actually has, in the order they are offered.
    /// Read once, after `configure()` returns.
    private(set) var availableLenses: [CameraLens] = []
    private(set) var lens: CameraLens = .wide
    /// The lens's horizontal field of view across a portrait screen, which is
    /// how wide a slice of the ring one photograph is credited with.
    private(set) var horizontalFieldOfView: Double = 54
    private(set) var resolution: PhotoResolution = .standard
    /// Whether the current lens can go past twelve megapixels at all.
    private(set) var offersHighResolution = false
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
    private var runtimeErrorObserver: NSObjectProtocol?

    func configure(resolution: PhotoResolution) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            sessionQueue.async {
                do {
                    self.resolution = resolution
                    try self.configureOnQueue()
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
        // A session that dies of a runtime error — the media server
        // restarting, a thermal event — stays dead unless somebody starts it
        // again, and what is on screen then is the last frame, frozen. That
        // looks exactly like a working camera pointed at something still.
        runtimeErrorObserver = NotificationCenter.default.addObserver(
            forName: AVCaptureSession.runtimeErrorNotification,
            object: session,
            queue: nil
        ) { [weak self] _ in
            guard let self else { return }
            self.sessionQueue.async {
                if !self.session.isRunning { self.session.startRunning() }
            }
        }
    }

    deinit {
        if let runtimeErrorObserver { NotificationCenter.default.removeObserver(runtimeErrorObserver) }
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

    /// Swaps which lens feeds the session, and returns its field of view.
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

    /// Changes the photo size from the next photograph on.
    func setResolution(_ resolution: PhotoResolution) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            sessionQueue.async {
                self.resolution = resolution
                if let device = self.device {
                    self.session.beginConfiguration()
                    self.applyOutputPolicy(for: device)
                    self.session.commitConfiguration()
                }
                continuation.resume()
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
    /// defaults when that configuration changes. Setting them once and
    /// swapping the input later would quietly turn deferred photo delivery
    /// back on partway through a walk-around, and a deferred proxy is not a
    /// photograph. What is supported differs per lens as well: the ultra-wide
    /// does not offer zero shutter lag on every model, and its largest photo
    /// is nowhere near the main camera's.
    private func applyOutputPolicy(for camera: AVCaptureDevice) {
        if output.isAutoDeferredPhotoDeliverySupported {
            output.isAutoDeferredPhotoDeliveryEnabled = false
        }
        output.isZeroShutterLagEnabled = output.isZeroShutterLagSupported
        output.maxPhotoQualityPrioritization = .quality

        let sizes = camera.activeFormat.supportedMaxPhotoDimensions
        let area = { (d: CMVideoDimensions) in Int(d.width) * Int(d.height) }
        offersHighResolution = sizes.contains { area($0) > PhotoResolution.pixelsInStandard }
        let standard = sizes
            .filter { area($0) <= PhotoResolution.pixelsInStandard }
            .max { area($0) < area($1) }
        let largest = sizes.max { area($0) < area($1) }
        let chosen = resolution == .high ? largest : (standard ?? largest)
        if let chosen { output.maxPhotoDimensions = chosen }
    }

    /// The field of view across the screen. AVFoundation reports it along
    /// the sensor's long edge, which on a portrait screen is the height —
    /// see `CoverageProjection.portraitFieldOfView`.
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
    func capturePhoto(stamp: CaptureStamp) async throws -> Photo {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Photo, Error>) in
            sessionQueue.async {
                guard self.device != nil else {
                    continuation.resume(throwing: CameraError.notConfigured)
                    return
                }

                // ⚠️ Portrait, said out loud on every shot. The app is locked
                // to portrait and the sensor is mounted landscape; the angle
                // goes into the file as an orientation tag, not a rotation of
                // the pixels — a second lossy pass for nothing.
                if let connection = self.output.connection(with: .video),
                   connection.isVideoRotationAngleSupported(90) {
                    connection.videoRotationAngle = 90
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
        // motion blur the quality gate would otherwise reject.
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
    private let completion: (Result<EvidenceCamera.Photo, Error>) -> Void

    init(customizer: MetadataCustomizer, completion: @escaping (Result<EvidenceCamera.Photo, Error>) -> Void) {
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
        let dimensions = photo.resolvedSettings.photoDimensions
        completion(.success(EvidenceCamera.Photo(
            data: data,
            pixelWidth: Int(dimensions.width),
            pixelHeight: Int(dimensions.height)
        )))
    }
}
