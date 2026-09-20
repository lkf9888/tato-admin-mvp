import AVFoundation
import EvidenceCore
import Foundation
import simd

/// Drives one walk around one car: which shot is next, what the camera just
/// produced, and whether it counts.
@MainActor
@Observable
final class CaptureSessionModel {

    /// How many goes at a slot before the operator is allowed to overrule the
    /// gate. Low enough not to trap anyone in front of a car, high enough
    /// that "just press it again" is the path of least resistance.
    static let attemptsBeforeOverride = 3

    enum Outcome: Equatable, Identifiable {
        var id: String {
            switch self {
            case .accepted(let record), .rejected(let record): return record.id
            case .failed(let message): return message
            }
        }

        case accepted(CaptureRecord)
        case rejected(CaptureRecord)
        case failed(String)
    }

    let camera = EvidenceCamera()
    let location = LocationProvider()
    let steadiness = SteadinessMonitor()
    let coverage = CoverageTracker()

    private(set) var archive: SessionArchive?
    private(set) var manifest: SessionManifest?
    private(set) var slotIndex = 0
    private(set) var outcome: Outcome?
    private(set) var isCapturing = false
    private(set) var startupError: String?
    var flashMode: AVCaptureDevice.FlashMode = .off

    let plan = ShotPlan.standard

    var currentSlot: ShotSlot { plan[min(slotIndex, plan.count - 1)] }
    var completedCount: Int { plan.count - (manifest?.outstandingSlots(in: plan).count ?? plan.count) }

    /// The operator may overrule the quality gate once the camera has been
    /// given a fair chance and the answer has not changed.
    var mayOverride: Bool {
        guard case .rejected = outcome else { return false }
        return attemptsForCurrentSlot >= Self.attemptsBeforeOverride
    }

    private(set) var attemptsForCurrentSlot = 0

    // MARK: - Lifecycle

    func begin(vehicleLabel: String, staffLabel: String, kind: SessionKind) async {
        do {
            let parent = try Self.sessionsDirectory()
            let manifest = SessionManifest(
                sessionID: Self.makeSessionID(),
                kind: kind,
                vehicleLabel: vehicleLabel,
                staffLabel: staffLabel,
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
        let slot = currentSlot

        do {
            let raw = try await camera.capturePhoto(stamp: stamp, flash: flashMode)
            let finished = try MetadataFinisher.finish(captured: raw, stamp: stamp)
            let quality = try ImageQualityGate.evaluate(jpeg: finished.data, thresholds: slot.thresholds)

            // Sharpness decides whether this photograph counts. A missing
            // location does not block the shot — underground car parks exist,
            // and stranding somebody mid-walk helps nobody — but it does
            // block the session, on the summary screen, where it can be fixed
            // by stepping outside rather than discovered months later by an
            // insurer.
            let record = try await archive.store(
                jpeg: finished.data,
                slot: slot,
                capturedAt: now,
                quality: quality,
                metadataPath: finished.path,
                accepted: quality.passes,
                stationVerified: stationVerification
            )
            manifest = await archive.manifest
            syncCoverageTargets()
            attemptsForCurrentSlot = await archive.attempts(forSlot: slot.id)
            outcome = quality.passes ? .accepted(record) : .rejected(record)
        } catch {
            outcome = .failed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
        }
    }

    /// Keep the photograph the gate turned down, with the reasons recorded
    /// against it.
    func acceptAnyway() async {
        guard let archive, case .rejected(let record) = outcome else { return }
        try? await archive.accept(record, despite: record.quality.issues)
        manifest = await archive.manifest
        outcome = .accepted(record)
    }

    /// Whether the photographer was standing where this shot is meant to be
    /// taken from. nil when the question cannot be answered honestly: an
    /// interior shot, a car never calibrated, or tracking lost.
    private var stationVerification: Bool? {
        guard currentSlot.station != nil,
              coverage.isCalibrated,
              coverage.isTracking,
              let placement = coverage.placement else { return nil }
        return CoverageMatcher.station(for: placement, among: [currentSlot]) != nil
    }

    private func syncCoverageTargets() {
        let outstanding = manifest?.outstandingSlots(in: plan) ?? plan
        coverage.outstanding = outstanding.filter { $0.station != nil }
    }

    // MARK: - Calibration

    func calibrateFromMesh() {
        coverage.calibrateFromMesh()
        syncCoverageTargets()
    }

    func markNose() {
        pendingNose = coverage.currentPosition
    }

    func markTail() {
        guard let nose = pendingNose, let tail = coverage.currentPosition else { return }
        coverage.calibrateByHand(nose: nose, tail: tail)
        pendingNose = nil
        syncCoverageTargets()
    }

    private(set) var pendingNose: SIMD3<Float>?

    var needsCalibration: Bool { currentSlot.station != nil && !coverage.isCalibrated }

    func advance() {
        outcome = nil
        attemptsForCurrentSlot = 0
        guard let manifest else { return }
        // Jump to the first slot still outstanding rather than the next one
        // in line, so a retake later on does not leave a hole behind it.
        if let next = manifest.outstandingSlots(in: plan).first,
           let index = plan.firstIndex(where: { $0.id == next.id }) {
            slotIndex = index
        } else {
            slotIndex = plan.count - 1
        }
    }

    func dismissOutcome() {
        outcome = nil
    }

    func clearStartupError() {
        startupError = nil
    }

    // MARK: - Session state

    var isComplete: Bool { manifest?.isComplete(in: plan) ?? false }

    /// Accepted photographs that an insurer would throw out unread. Almost
    /// always a location that was not available where the car was parked.
    var photosMissingEvidence: [CaptureRecord] { manifest?.recordsMissingEvidence ?? [] }

    /// Sortable, unique, and safe as a folder name. UTC so that sessions
    /// either side of a daylight-saving change still sort in the order they
    /// happened.
    private static func makeSessionID() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date()) + "-" + UUID().uuidString.prefix(8)
    }

    private static func sessionsDirectory() throws -> URL {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let sessions = support.appendingPathComponent("sessions", isDirectory: true)
        try FileManager.default.createDirectory(at: sessions, withIntermediateDirectories: true)
        return sessions
    }
}


