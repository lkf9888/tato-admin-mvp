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

    var flashMode: AVCaptureDevice.FlashMode = .off

    private let plateReader = PlateReader()

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

    func begin() async {
        guard archive == nil else { return }
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

            location.start()
            steadiness.start()
            coverage.start()
            try await camera.configure()
            lenses = camera.availableLenses
            lens = camera.lens
            coverage.fieldOfViewDegrees = camera.horizontalFieldOfView
            await camera.start()
        } catch {
            startupError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func end() async {
        await camera.stop()
        location.stop()
        steadiness.stop()
        coverage.stop()
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
            let raw = try await camera.capturePhoto(stamp: stamp, flash: flashMode)
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
