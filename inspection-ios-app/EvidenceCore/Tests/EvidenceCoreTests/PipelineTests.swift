import XCTest
import ImageIO
@testable import EvidenceCore

final class EvidenceRequirementsTests: XCTestCase {

    func testABareCameraFileIsNotClaimReady() {
        let check = EvidenceRequirements.check(jpeg: TestImages.checkerboard())
        XCTAssertFalse(check.isClaimReady)
        XCTAssertEqual(Set(check.gaps), [.noCaptureTime, .noTimeZoneOffset, .noLocation])
    }

    func testAStampedFileClearsTheFloor() throws {
        let stamped = try ExifStamper.stamp(jpeg: TestImages.checkerboard(), with: .fixture())
        XCTAssertTrue(EvidenceRequirements.check(jpeg: stamped.data).isClaimReady)
    }

    /// Location services switched off is the common way to lose a claim, and
    /// it has to read as a specific, fixable gap rather than a vague failure.
    func testNoFixReadsAsAMissingLocationAndNothingElse() throws {
        let stamped = try ExifStamper.stamp(jpeg: TestImages.checkerboard(), with: .fixture(location: nil))
        XCTAssertEqual(EvidenceRequirements.check(jpeg: stamped.data).gaps, [.noLocation])
    }

    func testNonImageBytes() {
        XCTAssertEqual(EvidenceRequirements.check(jpeg: Data("nope".utf8)).gaps, [.notJPEG])
    }
}

final class CaptureMetadataTests: XCTestCase {

    /// Exercised through ImageIO's direct property writer, which is the
    /// closest stand-in available off-device for what AVFoundation does when
    /// it flattens a photo. It is a stand-in, not the real thing — which is
    /// why the pipeline verifies the finished file on the phone rather than
    /// trusting this test to have settled it.
    private func written(_ metadata: [String: Any]) throws -> ExifReader {
        try XCTUnwrap(ExifReader(jpeg: TestImages.checkerboard(stringProperties: metadata)))
    }

    func testProducesReadableTimeAndPlace() throws {
        let exif = try written(CaptureMetadata.replacement(for: [:], with: .fixture()))

        XCTAssertEqual(exif.captureTime, "2026:09:09 17:26:40")
        XCTAssertEqual(exif.utcOffset, "-07:00")
        XCTAssertEqual(try XCTUnwrap(exif.latitude), 49.192139, accuracy: 0.00001)
        XCTAssertEqual(try XCTUnwrap(exif.longitude), -123.128917, accuracy: 0.00001)
        XCTAssertEqual(exif.string(ExifReader.gpsDateStamp, in: exif.gps), "2026:09:10")
        XCTAssertEqual(exif.cameraModel, "iPhone 16 Pro")
    }

    /// Unlike the ImageIO path, a direct EXIF writer takes the native date
    /// format and writes it correctly. Neither format is right everywhere,
    /// which is the whole reason the pipeline checks the result.
    func testUsesEXIFNativeGPSDatesNotISO8601() {
        let metadata = CaptureMetadata.replacement(for: [:], with: .fixture())
        let gps = metadata[kCGImagePropertyGPSDictionary as String] as? [String: Any]
        XCTAssertEqual(gps?[kCGImagePropertyGPSDateStamp as String] as? String, "2026:09:10")
        XCTAssertEqual(gps?[kCGImagePropertyGPSTimeStamp as String] as? String, "00:26:40.00")
    }

    func testLeavesTheCamerasOwnValuesAlone() throws {
        let fromCamera: [String: Any] = [
            kCGImagePropertyExifDictionary as String: [
                kCGImagePropertyExifDateTimeOriginal as String: "2026:01:02 03:04:05",
            ],
            kCGImagePropertyTIFFDictionary as String: [
                kCGImagePropertyTIFFModel as String: "iPhone 14 Pro",
            ],
        ]
        let exif = try written(CaptureMetadata.replacement(for: fromCamera, with: .fixture()))

        XCTAssertEqual(exif.captureTime, "2026:01:02 03:04:05")
        XCTAssertEqual(exif.cameraModel, "iPhone 14 Pro")
        XCTAssertEqual(exif.utcOffset, "-07:00", "the offset was missing, so it is ours to supply")
    }

    func testWithoutAFixThereIsNoGPSDictionaryAtAll() {
        let metadata = CaptureMetadata.replacement(for: [:], with: .fixture(location: nil))
        XCTAssertNil(metadata[kCGImagePropertyGPSDictionary as String])
    }
}

final class SessionArchiveTests: XCTestCase {
    private var parent: URL!

    override func setUpWithError() throws {
        parent = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: parent)
    }

    private func makeArchive() throws -> SessionArchive {
        try SessionArchive(parent: parent, manifest: SessionManifest(
            sessionID: "S1",
            kind: .checkin,
            vehicleLabel: "ABC 123",
            staffLabel: "Wei",
            deviceModel: "iPhone 16 Pro",
            appVersion: "0.1.0",
            startedAt: Date(timeIntervalSince1970: 1_789_000_000),
            timeZoneIdentifier: "America/Vancouver"
        ))
    }

    private func stampedPhoto() throws -> Data {
        try ExifStamper.stamp(jpeg: TestImages.checkerboard(), with: .fixture()).data
    }

    private func store(
        _ archive: SessionArchive,
        _ region: CarRegion = .front,
        jpeg: Data? = nil,
        accepted: Bool = true
    ) async throws -> CaptureRecord {
        let data = try jpeg ?? stampedPhoto()
        return try await archive.store(
            jpeg: data,
            region: region,
            capturedAt: Date(timeIntervalSince1970: 1_789_000_000),
            quality: try ImageQualityGate.evaluate(jpeg: data),
            metadataPath: .writtenAtCapture,
            accepted: accepted
        )
    }

    func testStoredFileMatchesItsRecordedDigest() async throws {
        let archive = try makeArchive()
        let record = try await store(archive)

        let onDisk = try Data(contentsOf: archive.url(of: record))

        XCTAssertEqual(EvidenceHash.sha256(onDisk), record.sha256)
        XCTAssertEqual(onDisk.count, record.byteCount)
        XCTAssertTrue(record.evidence.isClaimReady)
    }

    /// Originals are made read-only so that a later well-meaning edit-in-place
    /// fails loudly instead of quietly invalidating the digest.
    func testOriginalsAreWrittenReadOnly() async throws {
        let archive = try makeArchive()
        let record = try await store(archive, .front)

        let url = archive.url(of: record)
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        XCTAssertEqual(attributes[.posixPermissions] as? NSNumber, 0o444)
    }



    /// A photo taken with location services off is archived, not discarded —
    /// and it is flagged, because the fix is for someone to switch them on and
    /// shoot again, not for us to invent a coordinate.
    func testAPhotoWithNoFixIsKeptAndFlagged() async throws {
        let archive = try makeArchive()
        let noFix = try ExifStamper.stamp(jpeg: TestImages.checkerboard(), with: .fixture(location: nil)).data
        let record = try await store(archive, .front, jpeg: noFix)

        let flagged = await archive.manifest.recordsMissingEvidence.map(\.region)
        XCTAssertEqual(record.evidence.gaps, [.noLocation])
        XCTAssertEqual(flagged, [.front])
    }

    func testVerificationCatchesAnAlteredFile() async throws {
        let archive = try makeArchive()
        let record = try await store(archive, .front)
        let clean = try await archive.verifyAcceptedFiles()
        XCTAssertEqual(clean, [])

        let url = archive.url(of: record)
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: url.path)
        try Data("tampered".utf8).write(to: url)

        let mismatched = try await archive.verifyAcceptedFiles()
        XCTAssertEqual(mismatched, [record.filename])
    }

    func testManifestSurvivesAReopen() async throws {
        let archive = try makeArchive()
        _ = try await store(archive, .interior)

        let reopened = try SessionArchive(existing: archive.root)
        let (reloaded, original) = (await reopened.manifest, await archive.manifest)
        XCTAssertEqual(reloaded, original)
    }
}

final class MetadataFinisherTests: XCTestCase {

    /// The good path: AVFoundation wrote everything, so the file is passed
    /// through untouched and its digest is the camera's own.
    func testACompleteCaptureIsNotRewritten() throws {
        let complete = try ExifStamper.stamp(jpeg: TestImages.checkerboard(), with: .fixture()).data
        let outcome = try MetadataFinisher.finish(captured: complete, stamp: .fixture())

        XCTAssertEqual(outcome.path, .writtenAtCapture)
        XCTAssertEqual(outcome.data, complete)
        XCTAssertTrue(outcome.evidence.isClaimReady)
    }

    /// The repair path: the camera dropped the GPS, so it is supplied and the
    /// manifest says so.
    func testAnIncompleteCaptureIsStampedAndLabelled() throws {
        let outcome = try MetadataFinisher.finish(captured: TestImages.checkerboard(), stamp: .fixture())

        XCTAssertEqual(outcome.path, .stampedAfterCapture)
        XCTAssertTrue(outcome.evidence.isClaimReady)
        XCTAssertTrue(JPEGIntegrity.imageDataIsIdentical(TestImages.checkerboard(), outcome.data))
    }

    /// No fix to be had. The photo is still worth keeping — it just cannot be
    /// called claim-ready, and nothing is invented to make it look that way.
    func testWithNoFixTheGapSurvivesRatherThanBeingPaperedOver() throws {
        let outcome = try MetadataFinisher.finish(captured: TestImages.checkerboard(), stamp: .fixture(location: nil))

        XCTAssertFalse(outcome.evidence.isClaimReady)
        XCTAssertEqual(outcome.evidence.gaps, [.noLocation])
        XCTAssertNil(ExifReader(jpeg: outcome.data)?.latitude)
    }
}

final class OverrideTrailTests: XCTestCase {
    private var parent: URL!

    override func setUpWithError() throws {
        parent = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: parent)
    }

    /// A photo the gate turned down does not become the slot's photograph,
    /// and does not displace a good one taken earlier.
    func testARejectedAttemptIsFiledButDoesNotCount() async throws {
        let archive = try SessionArchive(parent: parent, manifest: SessionManifest(
            sessionID: "S2", kind: .checkout, vehicleLabel: "ABC 123", staffLabel: "Wei",
            deviceModel: "iPhone 16 Pro", appVersion: "0.1.0",
            startedAt: Date(timeIntervalSince1970: 1_789_000_000), timeZoneIdentifier: "America/Vancouver"
        ))
        let jpeg = try ExifStamper.stamp(jpeg: TestImages.checkerboard(), with: .fixture()).data
        let quality = try ImageQualityGate.evaluate(jpeg: jpeg)

        let good = try await archive.store(jpeg: jpeg, region: .front, capturedAt: Date(),
                                           quality: quality, metadataPath: .writtenAtCapture)
        let rejected = try await archive.store(jpeg: jpeg, region: .front, capturedAt: Date(),
                                               quality: quality, metadataPath: .writtenAtCapture,
                                               accepted: false)

        var manifest = await archive.manifest
        XCTAssertEqual(manifest.records.count, 2)
        XCTAssertEqual(manifest.acceptedRecords.count, 1, "the rejected one does not count")
        XCTAssertEqual(manifest.acceptedRecords.first?.sequence, good.sequence)

        // Waved through by the operator: now it counts, and the reason it
        // should not have is recorded next to it.
        try await archive.accept(rejected, despite: [.blurry])
        manifest = await archive.manifest
        XCTAssertEqual(manifest.acceptedRecords.count, 2, "both now count")
        XCTAssertEqual(manifest.records.first { $0.sequence == rejected.sequence }?.acceptedDespite, [.blurry])
    }
}
