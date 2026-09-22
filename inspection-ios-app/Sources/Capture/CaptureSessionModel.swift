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

    /// The arc of car one photograph documents, across a portrait screen.
    ///
    /// ⚠️ A constant now, where it used to be read off the capture device.
    /// ARKit picks the lens itself and does not say what field of view it
    /// ended up with, so this is the main camera's figure — about 68° along
    /// the sensor's long edge, which on a portrait screen is roughly 54°.
    /// See `CoverageProjection.portraitFieldOfView` for why those are
    /// different numbers.
    static let trackingFieldOfView = 54.0

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

    let location = LocationProvider()
    let steadiness = SteadinessMonitor()
    let coverage = CoverageTracker()
    /// ⚠️ Every photograph goes to the camera roll as it is taken, not when
    /// the session is handed in. A walk-around that never reaches the finish
    /// page used to leave the whole thing stranded in this app's container,
    /// where Turo's uploader cannot see it.
    let library = LibraryMirror()
    /// ⚠️ Built on the tracker's session rather than owning one. There is
    /// exactly one thing holding the camera in this app now, and it is ARKit.
    let camera: ARCamera

    private(set) var archive: SessionArchive?
    private(set) var manifest: SessionManifest?
    private(set) var outcome: Outcome?
    private(set) var isCapturing = false
    private(set) var startupError: String?
    private(set) var consecutiveRejections = 0
    private(set) var suggestedPlate: String?

    /// The last frame taken, small. Shown where the iPhone camera shows it,
    /// and for the same reason: it is the only confirmation a photographer
    /// needs that the shutter did something.
    private(set) var lastThumbnail: UIImage?

    /// What the last photograph actually came back at.
    ///
    /// Worth a line on screen because it is the resolution of every piece of
    /// evidence this app produces and it is not ours to choose: the video
    /// format decides, and whether a still bigger than the stream is even
    /// available depends on the device.
    private(set) var lastStillSize: String?

    /// Set when the last photograph did not show the car.
    ///
    /// Not a rejection: the file is archived like any other, because an
    /// archive that quietly drops frames is worse than one with a stray in
    /// it. It just does not count towards anything, and it says so.
    private(set) var missedTheCar = false

    /// A step the photographer picked out of order, which sticks until it is
    /// full and then hands control back to the plan.
    ///
    /// ⚠️ The plan prompts in order; it does not enforce one. Somebody
    /// standing at the back of the car should be able to do the rear wheels
    /// now rather than walking round twice, and a roof in the rain is a step
    /// to come back to. Refusing that is how a guided app gets abandoned for
    /// the camera app.
    var manualStep: ShotStep?

    /// Whether the lamp is lit, as the hardware last reported it rather
    /// than as the button last requested it.
    private(set) var isTorchOn = false
    /// Set when the torch was asked for and did not come on — almost always
    /// heat. Said out loud, because a button that does nothing reads as a
    /// broken app.
    private(set) var torchRefused = false

    private let plateReader = PlateReader()
    private var trackingWatch: Task<Void, Never>?

    init() {
        camera = ARCamera(session: coverage.session)
    }

    var progress: ShootingProgress {
        manifest?.progress(
            thinnestBearing: coverage.bearingToThinnest(),
            // Nothing to grade the walk-around against until a car has been
            // located. The count stands on its own until then.
            coverageIsMeasurable: coverage.canMeasure && coverage.hasFrame
        ) ?? ShootingProgress(coverage: 0, exteriorShots: 0, interiorShots: 0)
    }

    /// What the overlay is drawing, and what the next photograph counts
    /// towards.
    var currentStep: ShotStep? { manualStep ?? progress.currentStep }

    /// Moves along the plan by hand. Skips nothing — every step still has to
    /// be filled before the session can be handed in.
    func stepAside(by delta: Int) {
        let steps = ShotStep.allCases
        guard let here = currentStep, let index = steps.firstIndex(of: here) else { return }
        let wanted = min(max(index + delta, 0), steps.count - 1)
        manualStep = steps[wanted]
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
        // Asked here rather than at the shutter: a permission sheet that
        // appears between somebody and the photograph they are taking is a
        // photograph that does not get taken.
        Task { await library.authorise() }
        // A fresh budget of recovery attempts every time the screen comes
        // back. Closing an app and opening it again is what anybody does
        // when something looks stuck, and it should mean something.
        coverage.restarts = 0
        coverage.resume()
        coverage.fieldOfViewDegrees = Self.trackingFieldOfView

        watchTracking()
    }

    /// How long to wait before each attempt at putting tracking right.
    ///
    /// ⚠️ Bounded, and the bound is not timidity. Re-running the session
    /// blinks the viewfinder, and a preview that flickers every half minute
    /// for the rest of a walk-around is a worse app than one whose diagram is
    /// simply not filling in. Four tries spread over half a minute, then it
    /// stops and says so.
    private static let recoveryDelays: [Duration] = [.seconds(4), .seconds(6), .seconds(10), .seconds(16)]

    /// Waits for frames and runs tracking again if none arrive.
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

    /// Runs tracking again after it has stopped producing frames.
    ///
    /// Far simpler than it had to be when two sessions were competing for the
    /// camera: there is only one of them now, so there is nothing to stand
    /// aside for.
    private func recoverTracking() async {
        guard coverage.canMeasure else { return }
        coverage.restarts += 1
        coverage.restart()
    }

    /// ⚠️ The lamp is put out explicitly. It used to go out as a side effect
    /// of stopping the capture session; there is no capture session now, and
    /// a torch left burning in a pocket is a hot phone and a flat battery.
    func sleep() async {
        trackingWatch?.cancel()
        trackingWatch = nil
        camera.setTorch(false)
        isTorchOn = false
        torchRefused = false
        coverage.pause()
        steadiness.stop()
    }

    func end() async {
        await sleep()
        location.stop()
        coverage.stop()
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
    func toggleTorch() {
        let wanted = !isTorchOn
        let actual = camera.setTorch(wanted)
        isTorchOn = actual
        torchRefused = wanted && !actual
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
            let shot = try await camera.capturePhoto(stamp: stamp)
            // Portrait: the frame arrives on its side, so the long edge is
            // the height a person sees.
            lastStillSize = "\(shot.pixelHeight)×\(shot.pixelWidth)"
            let finished = MetadataFinisher.finish(encoded: shot.data)
            let quality = try ImageQualityGate.evaluate(jpeg: finished.data)

            // What this photograph was taken for, taken from the screen at
            // the moment of the shutter rather than guessed afterwards.
            let step = currentStep
            // Whether this step still owed photographs *before* this one.
            // ⚠️ Somebody who walked back to a step that is already full
            // wants to add to it, so that case must not hand control back
            // after a single frame — see below.
            let wasShort = step.map { !progress.isComplete($0) } ?? false

            // ⚠️ Asked before anything is credited. A photograph of a garage
            // floor used to count towards the exterior floor exactly like a
            // photograph of a door.
            //
            // ⚠️ And asked only of the walk-around. The check reads what
            // share of the frame the scanned car fills, which means nothing
            // when the subject is one wheel arch, the view from the driver's
            // seat, or a roof shot from underneath it. Applied to those, it
            // turned down the photographs somebody had just been told to
            // take. See `ShotStep.needsTheCarInFrame`.
            let checkFraming = step?.needsTheCarInFrame ?? true
            let framing = checkFraming ? coverage.framingNow() : nil
            let showsCar = framing?.showsTheCar ?? true
            missedTheCar = !showsCar
            let counts = quality.passes && showsCar

            let region: CarRegion
            if !counts {
                region = .front
            } else if step?.isInterior == true {
                region = .interior
            } else {
                // The pose credits the coverage whatever the subject was —
                // somebody photographing a wheel is still standing on that
                // side of the car. The step gets the last word on the label,
                // because a roof is shot from beside the car and the pose
                // would file it as a flank.
                let fromPose = coverage.recordShot()
                region = step?.region ?? fromPose
            }

            let record = try await archive.store(
                jpeg: finished.data,
                region: region,
                capturedAt: now,
                quality: quality,
                metadataPath: finished.path,
                accepted: counts,
                // Recorded even when it did not count: what somebody was
                // aiming at is part of the record, and a shot waved through
                // afterwards has to land on the right step.
                step: step
            )
            // ⚠️ Before any verdict is applied. Whether the gate liked the
            // photograph has nothing to do with whether the person who took
            // it should be able to find it afterwards.
            library.mirror(finished.data, as: record, into: archive, sessionStart: archive.startedAt)

            if quality.passes {
                try await archive.updateCoverage(coverage.coverage)
                consecutiveRejections = 0
            } else {
                consecutiveRejections += 1
            }
            manifest = await archive.manifest
            // Hand control back to the plan once a hand-picked step that
            // owed photographs has been filled. A step somebody went back to
            // top up stays put until they move off it themselves.
            if let picked = manualStep, wasShort, progress.isComplete(picked) { manualStep = nil }
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
        if record.step?.isInterior != true { coverage.recordShot() }
        try? await archive.updateCoverage(coverage.coverage)
        manifest = await archive.manifest
        consecutiveRejections = 0
        outcome = nil
    }

    func dismissOutcome() { outcome = nil }

    /// Takes an updated manifest back from a page that changed the archive —
    /// the finish page, which notes where each photograph landed in the
    /// camera roll.
    func refreshManifest(_ manifest: SessionManifest) { self.manifest = manifest }

    func clearStartupError() { startupError = nil }

    /// Reads the JPEG's own embedded preview rather than decoding it.
    ///
    /// ⚠️ `...IfAbsent` rather than `...Always`, which used to be free: a
    /// camera JPEG always carried a hardware thumbnail to take. This app
    /// writes the file now and does not embed one, so this decodes the frame
    /// at reduced scale instead. Still far cheaper than a full decode.
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
