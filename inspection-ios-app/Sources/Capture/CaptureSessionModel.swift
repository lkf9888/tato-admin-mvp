import AVFoundation
import EvidenceCore
import Foundation
import ImageIO
import UIKit
import simd

/// One walk around one car.
///
/// **There is no setup.** The session opens as the camera does, before
/// anybody has said which car it is or which end of the trip this is — both
/// of those are answered at the end, when the app can usually answer them
/// itself. The photographer's first interaction with this app is a shutter
/// button.
@MainActor
@Observable
final class CaptureSessionModel {

    /// How many rejected shots in a row before the operator may overrule the
    /// quality gate. Low enough not to trap anyone in front of a car.
    static let rejectionsBeforeOverride = 3

    enum Outcome: Equatable, Identifiable {
        case accepted(CaptureRecord)
        case rejected(CaptureRecord)
        case failed(String)

        var id: String {
            switch self {
            case .accepted(let record), .rejected(let record): return record.id
            case .failed(let message): return message
            }
        }
    }

    let camera = EvidenceCamera()
    let location = LocationProvider()
    let steadiness = SteadinessMonitor()
    let coverage = CoverageTracker()

    private(set) var archive: SessionArchive?
    private(set) var manifest: SessionManifest?
    private(set) var outcome: Outcome?
    private(set) var isCapturing = false
    private(set) var startupError: String?
    private(set) var consecutiveRejections = 0
    private(set) var suggestedPlate: String?

    /// The lenses this phone turned out to have, and the one in use. Both
    /// are snapshots taken once the capture session has finished
    /// configuring, so the camera's own copies are never read across threads.
    private(set) var lenses: [CameraLens] = []
    private(set) var lens: CameraLens = .wide

    /// The last frame taken, small. Shown where the iPhone camera shows it,
    /// and for the same reason: it is the only confirmation a photographer
    /// needs that the shutter did something.
    private(set) var lastThumbnail: UIImage?

    /// Why the viewfinder is frozen, when it is.
    ///
    /// A capture session that has been interrupted stays frozen on its last
    /// frame and says nothing, which is indistinguishable from a camera that
    /// is working and pointed at something that is not moving. Naming the
    /// reason is what turns "偶尔卡住" into a bug report.
    private(set) var cameraNotice: String?

    /// Whether the lamp is lit, as the hardware last reported it rather
    /// than as the button last requested it.
    private(set) var isTorchOn = false
    /// Set when the torch was asked for and did not come on — almost always
    /// heat. Said out loud, because a button that does nothing reads as a
    /// broken app.
    private(set) var torchRefused = false

    private let plateReader = PlateReader()
    private var cameraConfigured = false
    /// Torn down in `end()` rather than in `deinit`: a `deinit` on a
    /// `@MainActor` type runs outside that isolation and may not touch
    /// these. The blocks hold `self` weakly, so one that outlives the model
    /// does nothing rather than crashing.
    private var sessionObservers: [NSObjectProtocol] = []
    private var trackingWatch: Task<Void, Never>?

    var progress: ShootingProgress {
        manifest?.progress() ?? ShootingProgress(coverage: 0, exteriorShots: 0, interiorShots: 0)
    }

    /// Whether the photographer may overrule a rejection, having given the
    /// camera a fair chance and got the same answer.
    var mayOverride: Bool {
        guard case .rejected = outcome else { return false }
        return consecutiveRejections >= Self.rejectionsBeforeOverride
    }

    // MARK: - Lifecycle

    /// ⚠️ Called every time the camera screen appears, not only the first
    /// time. It used to return early whenever an archive already existed,
    /// while `end()` stopped the capture session — so a single
    /// disappear-and-return left the viewfinder frozen on its last frame
    /// with nothing ever restarting it. The archive is created once; the
    /// camera is brought back every time.
    func begin() async {
        if archive == nil { await openArchive() }
        await wake()
    }

    private func openArchive() async {
        do {
            let parent = try ArchiveIndex.sessionsDirectory()
            // Named later. An empty label here is honest: nobody has said
            // which car this is yet, and inventing a placeholder would put a
            // wrong answer in the archive.
            let manifest = SessionManifest(
                sessionID: Self.makeSessionID(),
                kind: .checkin,
                vehicleLabel: "",
                staffLabel: "",
                deviceModel: DeviceIdentity.machine,
                appVersion: DeviceIdentity.appVersion,
                startedAt: Date(),
                timeZoneIdentifier: TimeZone.current.identifier
            )
            let archive = try SessionArchive(parent: parent, manifest: manifest)
            self.archive = archive
            self.manifest = manifest
        } catch {
            startupError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Brings everything back: on launch, on returning from the background,
    /// and after the camera screen has been away behind something else.
    ///
    /// Safe to call when already awake — each piece checks for itself.
    func wake() async {
        guard archive != nil, startupError == nil else { return }

        location.start()
        steadiness.start()
        // A fresh budget of recovery attempts every time the screen comes
        // back. Closing an app and opening it again is what anybody does
        // when something looks stuck, and it should mean something.
        coverage.restarts = 0

        // ⚠️ Tracking goes first, and the asymmetry is the whole point.
        //
        // A tracking session already under way survives the photo session
        // taking hold of the same back camera — measured, 60 frames a second
        // with both live. One asked to start *against* a capture session that
        // is already running does not: it is interrupted on the spot and
        // never recovers, however many times it is re-run, because the lens
        // is not available to it at all. Reversing these two lines looks
        // tidier and silently kills the coverage diagram.
        coverage.resume()

        if !cameraConfigured {
            do {
                try await camera.configure()
                lenses = camera.availableLenses
                lens = camera.lens
                coverage.fieldOfViewDegrees = camera.horizontalFieldOfView
                cameraConfigured = true
                watchCaptureSession()
            } catch {
                startupError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                return
            }
        }

        await camera.start()
        if camera.session.isRunning { cameraNotice = nil }

        watchTracking()
    }

    /// How long to wait before each attempt at putting tracking right.
    ///
    /// ⚠️ Bounded, and the bound is not timidity. Recovery makes the camera
    /// let go and take hold again, which blinks the viewfinder — a preview
    /// that flickers every half minute for the rest of a walk-around is a
    /// worse app than one whose diagram is simply not filling in. Four tries
    /// spread over half a minute, and then it stops and says so.
    private static let recoveryDelays: [Duration] = [.seconds(4), .seconds(6), .seconds(10), .seconds(16)]

    /// Waits for frames and re-sequences both sessions if none arrive.
    ///
    /// Nobody is asked to do this. It was briefly a button in the settings
    /// screen, which is a confession rather than a feature: "重启车形图"
    /// means nothing to somebody holding a phone in front of a car, and the
    /// app knows perfectly well when it needs doing.
    private func watchTracking() {
        trackingWatch?.cancel()
        guard coverage.canMeasure else { return }
        trackingWatch = Task { [weak self] in
            for delay in Self.recoveryDelays {
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled, let self, self.coverage.needsHelp else { return }
                await self.recoverTracking()
                // A recovery that worked shows up as frames within a second.
                try? await Task.sleep(for: .seconds(1.5))
                guard !Task.isCancelled, self.coverage.needsHelp else { return }
            }
        }
    }

    /// Puts tracking back on its feet by rebuilding the order it needs.
    ///
    /// Re-running the AR session on its own cannot work while the photo
    /// session holds the camera — that is what "已重启 6 次" was, six
    /// identical failures. The camera has to let go first, tracking has to
    /// take hold, and only then does the camera come back.
    private func recoverTracking() async {
        guard coverage.canMeasure else { return }
        coverage.restarts += 1
        await camera.stop()
        coverage.restart()
        // Long enough for ARKit to have the lens before it is asked to share.
        try? await Task.sleep(for: .milliseconds(500))
        await camera.start()
    }

    /// Lets go of the camera without throwing the session away. iOS takes it
    /// back on the way to the background regardless; releasing it deliberately
    /// means the state on the way in is one we chose.
    /// ⚠️ `camera.stop()` douses the torch as part of letting go of the
    /// device, which is what makes "the lamp goes out when you leave the
    /// app" true rather than merely intended. The flag is cleared here so
    /// the button tells the truth on the way back in.
    func sleep() async {
        trackingWatch?.cancel()
        trackingWatch = nil
        await camera.stop()
        isTorchOn = false
        torchRefused = false
        coverage.pause()
        steadiness.stop()
    }

    func end() async {
        await sleep()
        location.stop()
        coverage.stop()
        for observer in sessionObservers { NotificationCenter.default.removeObserver(observer) }
        sessionObservers = []
    }

    /// What the photographer presses when the picture has stopped moving.
    func restartCamera() async {
        cameraNotice = nil
        await camera.stop()
        await camera.start()
        if !camera.session.isRunning {
            cameraNotice = "相机没能重新启动 —— 退出 App 重进一次"
        }
    }

    // MARK: - When something else takes the camera

    /// A capture session is interrupted by things this app does not control:
    /// a phone call, Split View, the phone getting too hot, or another
    /// session in this very process asking for the same lens. None of them
    /// produce an error — the frames simply stop.
    private func watchCaptureSession() {
        let centre = NotificationCenter.default
        let session = camera.session

        sessionObservers = [
            centre.addObserver(
                forName: AVCaptureSession.wasInterruptedNotification,
                object: session,
                queue: .main
            ) { note in
                // Only a plain Int crosses into the Task: a Notification is
                // not Sendable and has no business on another actor.
                let raw = note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int
                Task { @MainActor [weak self] in self?.noteInterruption(raw) }
            },
            centre.addObserver(
                forName: AVCaptureSession.interruptionEndedNotification,
                object: session,
                queue: .main
            ) { _ in
                Task { @MainActor [weak self] in await self?.restartCamera() }
            },
            centre.addObserver(
                forName: AVCaptureSession.runtimeErrorNotification,
                object: session,
                queue: .main
            ) { _ in
                Task { @MainActor [weak self] in await self?.restartCamera() }
            },
        ]
    }

    private func noteInterruption(_ rawReason: Int?) {
        let reason = rawReason.flatMap(AVCaptureSession.InterruptionReason.init(rawValue:))
        switch reason {
        case .videoDeviceInUseByAnotherClient:
            // The one worth spelling out. Inside this app the other client
            // would be ARKit, which wants the same back camera for the
            // coverage diagram -- see the note in DEVICE-CHECKLIST §B0.
            cameraNotice = "摄像头被别的东西占用了"
        case .videoDeviceNotAvailableWithMultipleForegroundApps:
            cameraNotice = "分屏状态下相机不可用"
        case .videoDeviceNotAvailableDueToSystemPressure:
            cameraNotice = "手机过热，相机被系统收走了"
        case .videoDeviceNotAvailableInBackground:
            // Ordinary and self-correcting: the app went away and came back.
            cameraNotice = nil
        default:
            cameraNotice = "画面停住了"
        }
    }

    // MARK: - The lamp

    /// One tap lights it and it stays lit, rather than firing per shot.
    ///
    /// A flash has to be metered for before every frame, which is a delay
    /// the photographer feels on every single press — and asking for it
    /// switches zero shutter lag off, so the frames come back softer as
    /// well. Continuous light costs that nothing: the scene is already lit
    /// when the shutter is pressed, and what is on screen is what will be in
    /// the file.
    func toggleTorch() async {
        let wanted = !isTorchOn
        let actual = await camera.setTorch(wanted)
        isTorchOn = actual
        torchRefused = wanted && !actual
    }

    // MARK: - Lenses

    /// Switches glass, and tells the coverage tracker what the new glass can
    /// see. The two go together: the field of view is the only thing that
    /// turns a camera pose into an arc of painted car, and the ultra-wide's
    /// is nearly twice the main camera's.
    ///
    /// A lens that refuses to attach leaves the working one in place, so the
    /// walk-around continues on the lens that was already running.
    func select(lens: CameraLens) async {
        guard lens != self.lens, lenses.contains(lens) else { return }
        guard let fieldOfView = try? await camera.select(lens) else { return }
        self.lens = lens
        coverage.fieldOfViewDegrees = fieldOfView
    }

    // MARK: - Capture

    func capture() async {
        guard let archive, !isCapturing else { return }
        isCapturing = true
        defer { isCapturing = false }

        let now = Date()
        let stamp = CaptureStamp(
            capturedAt: now,
            timeZone: .current,
            location: location.currentFix(now: now),
            deviceMake: "Apple",
            deviceModel: DeviceIdentity.machine,
            software: DeviceIdentity.appVersion
        )

        do {
            let raw = try await camera.capturePhoto(stamp: stamp)
            let finished = try MetadataFinisher.finish(captured: raw, stamp: stamp)
            let quality = try ImageQualityGate.evaluate(jpeg: finished.data)

            // Where the photograph turned out to be pointing, worked out from
            // the camera's pose after the fact. Only credited to the car's
            // surface when the gate passed: a blurred picture of a door
            // documents nothing.
            let region = quality.passes ? coverage.recordShot() : .front

            let record = try await archive.store(
                jpeg: finished.data,
                region: region,
                capturedAt: now,
                quality: quality,
                metadataPath: finished.path,
                accepted: quality.passes
            )
            if quality.passes {
                try await archive.updateCoverage(coverage.coverage)
                consecutiveRejections = 0
            } else {
                consecutiveRejections += 1
            }
            manifest = await archive.manifest
            // Shown whether or not the gate liked it: seeing the blurred
            // frame is how somebody works out that they moved.
            lastThumbnail = Self.thumbnail(of: finished.data)
            outcome = quality.passes ? .accepted(record) : .rejected(record)

            // Read the plate off the photograph rather than asking for it.
            Task.detached { [plateReader] in
                await plateReader.read(jpeg: finished.data)
            }
            await refreshSuggestedPlate()
        } catch {
            outcome = .failed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
        }
    }

    /// Keeps a photograph the gate turned down, with the reasons recorded.
    func acceptAnyway() async {
        guard let archive, case .rejected(let record) = outcome else { return }
        try? await archive.accept(record, despite: record.quality.issues)
        coverage.recordShot()
        try? await archive.updateCoverage(coverage.coverage)
        manifest = await archive.manifest
        consecutiveRejections = 0
        outcome = nil
    }

    func dismissOutcome() { outcome = nil }

    func clearStartupError() { startupError = nil }

    /// Reads the JPEG's own embedded preview rather than decoding it.
    ///
    /// A 48-megapixel frame takes a noticeable moment to decode, and every
    /// camera JPEG already carries a thumbnail written by the hardware --
    /// `...IfAbsent` takes that one when it is there, which it always is.
    private static func thumbnail(of jpeg: Data, maxPixel: Int = 200) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(jpeg as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageIfAbsent: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        return UIImage(cgImage: image)
    }

    private func refreshSuggestedPlate() async {
        suggestedPlate = await plateReader.confident
    }

    // MARK: - Finishing

    /// Names the car and the occasion, which is the only thing anybody is
    /// ever asked to confirm.
    func describe(vehicleLabel: String, staffLabel: String, kind: SessionKind) async {
        guard let archive else { return }
        try? await archive.describe(vehicleLabel: vehicleLabel, kind: kind)
        manifest = await archive.manifest
    }

    private static func makeSessionID() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date()) + "-" + UUID().uuidString.prefix(8)
    }
}
