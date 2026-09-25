import AVFoundation
import EvidenceCore
import Foundation
import ImageIO
import UIKit

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

    let location = LocationProvider()
    /// The shutter's steadiness gate, and — from the same sensor — which way
    /// the camera faces. The heading is what replaced ARKit's surface model
    /// as the answer to "have they been round the car".
    let steadiness = SteadinessMonitor()
    /// ⚠️ Every photograph goes to the camera roll as it is taken, not when
    /// the session is handed in. A walk-around that never reaches the finish
    /// page used to leave the whole thing stranded in this app's container,
    /// where Turo's uploader cannot see it.
    let library = LibraryMirror()
    /// ⚠️ The iPhone's own camera pipeline, holding the back camera alone.
    /// It used to be ARKit, for a LiDAR model of the car's surface; that
    /// model and this camera cannot both hold the lens, and the app chose
    /// the better photographs and both lenses. See `EvidenceCamera`.
    let camera = EvidenceCamera()
    private var cameraReady = false

    /// The lenses this phone has, for the zoom pill. One lens means no pill.
    private(set) var lenses: [CameraLens] = []
    private(set) var lens: CameraLens = .wide
    /// How wide a slice of the ring one photograph from this lens is worth.
    private(set) var fieldOfView = 54.0
    private(set) var offersHighResolution = false
    /// Twelve megapixels unless somebody chose otherwise in settings, and the
    /// choice is remembered — see `PhotoResolution.standard` for why twelve.
    private(set) var resolution: PhotoResolution =
        PhotoResolution(rawValue: UserDefaults.standard.string(forKey: "photoResolution") ?? "") ?? .standard

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
    /// The heading of a photograph the quality gate turned down, kept so that
    /// waving it through afterwards credits the ring from where it was taken.
    private var rejectedHeading: Double?

    var progress: ShootingProgress {
        manifest?.progress(heading: steadiness.heading)
            ?? ShootingProgress(coverage: 0, exteriorShots: 0, interiorShots: 0)
    }

    /// The ring of directions photographed from so far.
    var headings: HeadingCoverage { manifest?.headings ?? HeadingCoverage() }

    /// What the overlay is drawing, and what the next photograph counts
    /// towards.
    var currentStep: ShotStep? { manualStep ?? progress.currentStep }

    /// Moves along the plan by hand, in either direction. Nothing is skipped
    /// for good: a step left short is listed on the finish page.
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

        if !cameraReady {
            do {
                try await camera.configure(resolution: resolution)
                cameraReady = true
                lenses = camera.availableLenses
                lens = camera.lens
                fieldOfView = camera.horizontalFieldOfView
                offersHighResolution = camera.offersHighResolution
            } catch {
                startupError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                return
            }
        }
        // ⚠️ Every time, not only the first. Tearing the session down on the
        // way out and guarding the rebuild behind "have we started before?"
        // is what once left the viewfinder frozen on a stale frame after any
        // trip away from this screen.
        await camera.start()
    }

    /// ⚠️ The lamp goes out with the camera, and the camera goes down with
    /// the screen. A torch left burning in a pocket is a hot phone and a flat
    /// battery.
    func sleep() async {
        isTorchOn = false
        torchRefused = false
        await camera.stop()
        steadiness.stop()
    }

    func end() async {
        await sleep()
        location.stop()
    }

    // MARK: - Lenses and size

    func select(lens: CameraLens) async {
        do {
            fieldOfView = try await camera.select(lens)
            self.lens = camera.lens
            // Swapping the input drops the torch; the camera relights it,
            // and this reads back whether it managed to.
            isTorchOn = camera.isTorchOn
        } catch {
            outcome = .failed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
        }
    }

    func setResolution(_ resolution: PhotoResolution) async {
        self.resolution = resolution
        UserDefaults.standard.set(resolution.rawValue, forKey: "photoResolution")
        await camera.setResolution(resolution)
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
        Task {
            let actual = await camera.setTorch(wanted)
            isTorchOn = actual
            torchRefused = wanted && !actual
        }
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

        // ⚠️ Read before the shutter, not after. A capture takes hundreds of
        // milliseconds and the phone starts moving the instant somebody has
        // pressed the button; asking afterwards asks about a direction the
        // photograph was never taken in -- often the floor, on the way down.
        let step = currentStep
        let heading = steadiness.headingNow
        // Whether this step still owed photographs *before* this one.
        // ⚠️ Somebody who walked back to a step that is already full wants to
        // add to it, so that case must not hand control back after a single
        // frame — see below.
        let wasShort = step.map { !progress.isComplete($0) } ?? false

        do {
            let shot = try await camera.capturePhoto(stamp: stamp)
            // Portrait: the sensor delivers landscape, so the long edge is
            // the height a person sees.
            lastStillSize = "\(min(shot.pixelWidth, shot.pixelHeight))×\(max(shot.pixelWidth, shot.pixelHeight))"
            let finished = MetadataFinisher.finish(encoded: shot.data)
            let quality = try ImageQualityGate.evaluate(jpeg: finished.data)

            let record = try await archive.store(
                jpeg: finished.data,
                // From the step: there is no camera pose to file by. See
                // `ShotStep.region`.
                region: step?.region ?? .exterior,
                capturedAt: now,
                quality: quality,
                metadataPath: finished.path,
                accepted: quality.passes,
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
                if step?.creditsTheRing == true, let heading {
                    await credit(heading: heading, in: archive)
                }
                consecutiveRejections = 0
                rejectedHeading = nil
            } else {
                consecutiveRejections += 1
                rejectedHeading = step?.creditsTheRing == true ? heading : nil
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
        if let rejectedHeading { await credit(heading: rejectedHeading, in: archive) }
        rejectedHeading = nil
        manifest = await archive.manifest
        consecutiveRejections = 0
        outcome = nil
    }

    /// Adds one photograph's direction to the ring, and keeps it.
    private func credit(heading: Double, in archive: SessionArchive) async {
        var ring = await archive.manifest.headings
        ring.record(heading: heading, spreadDegrees: HeadingCoverage.spread(forFieldOfView: fieldOfView))
        try? await archive.updateHeadingCoverage(ring)
    }

    func dismissOutcome() { outcome = nil }

    /// Takes an updated manifest back from a page that changed the archive —
    /// the finish page, which notes where each photograph landed in the
    /// camera roll.
    func refreshManifest(_ manifest: SessionManifest) { self.manifest = manifest }

    func clearStartupError() { startupError = nil }

    /// Reads the JPEG's own embedded preview where there is one, and decodes
    /// the frame at reduced scale where there is not. Either is far cheaper
    /// than a full decode.
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
