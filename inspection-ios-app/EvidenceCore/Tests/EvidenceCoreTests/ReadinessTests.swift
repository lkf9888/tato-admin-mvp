import XCTest
import ImageIO
@testable import EvidenceCore

private func makeManifest(with records: [CaptureRecord]) -> SessionManifest {
    var manifest = SessionManifest(
        sessionID: "S9", kind: .checkin, vehicleLabel: "ABC 123", staffLabel: "Wei",
        deviceModel: "iPhone 16 Pro", appVersion: "TATO Evidence 0.1.0",
        startedAt: Date(timeIntervalSince1970: 1_789_000_000), timeZoneIdentifier: "America/Vancouver"
    )
    manifest.records = records
    return manifest
}

private func makeRecord(
    _ slotID: String,
    gaps: [EvidenceGap] = [],
    stationVerified: Bool? = true,
    despite: [ImageQualityIssue] = [],
    attempt: Int = 1
) -> CaptureRecord {
    CaptureRecord(
        slotID: slotID, attempt: attempt, filename: "\(slotID)-\(attempt).jpg", byteCount: 2_400_000,
        sha256: String(repeating: "a", count: 64), capturedAt: Date(timeIntervalSince1970: 1_789_000_000),
        quality: ImageQualityReport(laplacianVariance: 900, meanLuminance: 118, luminanceStdDev: 44,
                                    clippedHighlightFraction: 0.01, clippedShadowFraction: 0.02,
                                    issues: despite),
        evidence: EvidenceCheck(gaps: gaps), metadataPath: .writtenAtCapture,
        accepted: true, acceptedDespite: despite, stationVerified: stationVerified
    )
}

private var completeSet: [CaptureRecord] { ShotPlan.standard.map { makeRecord($0.id) } }

final class SessionReadinessTests: XCTestCase {

    func testAnIncompleteSetCannotBeFinished() {
        let readiness = makeManifest(with: [makeRecord("front")]).readiness()
        XCTAssertFalse(readiness.canFinish)
        XCTAssertEqual(readiness.blockers, [.shotsOutstanding(count: ShotPlan.standard.count - 1)])
    }

    func testACleanSetFinishesWithNothingToSay() {
        let readiness = makeManifest(with: completeSet).readiness()
        XCTAssertTrue(readiness.canFinish)
        XCTAssertTrue(readiness.warnings.isEmpty)
        XCTAssertFalse(readiness.needsAcknowledgement)
    }

    /// Underground car parks exist and cars get wedged against walls. None of
    /// these stops the job — they stop somebody walking off without knowing.
    func testTheThingsThatWarnRatherThanBlock() {
        var records = completeSet
        records[0] = makeRecord(records[0].slotID, gaps: [.noLocation])
        records[1] = makeRecord(records[1].slotID, stationVerified: false)
        records[2] = makeRecord(records[2].slotID, despite: [.blurry])

        let readiness = makeManifest(with: records).readiness()
        XCTAssertTrue(readiness.canFinish)
        XCTAssertTrue(readiness.needsAcknowledgement)
        XCTAssertEqual(Set(readiness.warnings), [
            .missingLocation(count: 1),
            .takenOffStation(count: 1),
            .qualityOverridden(count: 1),
        ])
    }

    /// A shot that was never position-tracked proves nothing either way, and
    /// must not be reported as an offence.
    func testUntrackedShotsAreNotCountedAgainstAnyone() {
        let records = ShotPlan.standard.map { makeRecord($0.id, stationVerified: nil) }
        XCTAssertTrue(makeManifest(with: records).readiness().warnings.isEmpty)
    }
}

final class ExportManifestTests: XCTestCase {

    func testListsEveryDigestAndTheFileItCovers() {
        let text = ExportManifest.plainText(for: makeManifest(with: completeSet))
        for slot in ShotPlan.standard {
            XCTAssertTrue(text.contains("\(slot.id)-1.jpg"), "\(slot.id) is missing from the manifest")
        }
        XCTAssertTrue(text.contains("ABC 123"))
        XCTAssertTrue(text.contains("Return from guest"))
    }

    func testNamesTheShotsThatWereNeverTaken() {
        let text = ExportManifest.plainText(for: makeManifest(with: [makeRecord("front")]))
        XCTAssertTrue(text.contains("MISSING   odometer"))
        XCTAssertFalse(text.contains("MISSING   front "))
    }

    /// A record that quietly omits its own weak points is worth less than one
    /// that lists them: the first thing an opponent does is look for what was
    /// left out.
    func testStatesTheWeakPointsInsteadOfBuryingThem() {
        var records = completeSet
        records[0] = makeRecord(records[0].slotID, gaps: [.noLocation], stationVerified: false,
                            despite: [.blurry], attempt: 3)
        let text = ExportManifest.plainText(for: makeManifest(with: records))

        XCTAssertTrue(text.contains("no geolocation recorded"))
        XCTAssertTrue(text.contains("not taken from the planned position"))
        XCTAssertTrue(text.contains("accepted despite: blurry"))
        XCTAssertTrue(text.contains("attempt 3"))
    }

    /// The audience is an adjuster or a lawyer, who will not read Chinese and
    /// will not run our software.
    func testIsInEnglishAndVerifiableWithStandardTools() {
        let text = ExportManifest.plainText(for: makeManifest(with: completeSet))
        XCTAssertTrue(text.contains("SHA-256"))
        // `shasum -c` format: digest, two spaces, filename.
        XCTAssertTrue(text.contains("\(String(repeating: "a", count: 64))  front-1.jpg"))
    }
}

final class ProvenanceTests: XCTestCase {

    private var manifest: SessionManifest {
        makeManifest(with: [makeRecord("front"), makeRecord("rear")])
    }

    private var knownDigest: String { String(repeating: "a", count: 64) }
    private var knownTime: Date { Date(timeIntervalSince1970: 1_789_000_000) }

    func testAMatchingDigestIsTheOriginal() {
        XCTAssertEqual(
            manifest.provenance(ofDigest: knownDigest, capturedAt: knownTime),
            .original(filename: "front-1.jpg", vehicleLabel: "ABC 123")
        )
    }

    /// The case that proves a delivery path re-encodes: taken at the same
    /// instant as one of ours, different bytes.
    func testSameMomentDifferentBytesIsAltered() {
        XCTAssertEqual(
            manifest.provenance(ofDigest: String(repeating: "b", count: 64), capturedAt: knownTime),
            .altered(filename: "front-1.jpg", vehicleLabel: "ABC 123")
        )
    }

    /// Somebody's holiday snap. Reporting this as "not the original" would
    /// cry wolf on every photo in the camera roll and train people to ignore
    /// the one answer that matters.
    func testAPhotographWeNeverTookIsUnknownNotAltered() {
        XCTAssertEqual(
            manifest.provenance(ofDigest: String(repeating: "c", count: 64),
                                capturedAt: Date(timeIntervalSince1970: 1_000_000_000)),
            .unknown
        )
    }

    func testWithoutACaptureTimeThereIsNothingToMatchOn() {
        XCTAssertEqual(
            manifest.provenance(ofDigest: String(repeating: "d", count: 64), capturedAt: nil),
            .unknown
        )
    }
}

final class ExifCaptureInstantTests: XCTestCase {

    func testCombinesLocalTimeWithItsOffset() throws {
        let stamped = try ExifStamper.stamp(jpeg: TestImages.checkerboard(), with: .fixture()).data
        let exif = try XCTUnwrap(ExifReader(jpeg: stamped))
        XCTAssertEqual(try XCTUnwrap(exif.capturedAt).timeIntervalSince1970, 1_789_000_000, accuracy: 1)
    }

    /// A local time with no offset names a different instant in every zone.
    /// Picking one would be inventing the fact the whole 24-hour window turns
    /// on, so it stays nil.
    func testRefusesToGuessAnInstantWithoutAnOffset() throws {
        let noOffset = TestImages.checkerboard(properties: [
            kCGImagePropertyExifDictionary: [
                kCGImagePropertyExifDateTimeOriginal: "2026:09:09 17:26:40",
            ] as [CFString: Any],
        ])
        let exif = try XCTUnwrap(ExifReader(jpeg: noOffset))
        XCTAssertNotNil(exif.captureTime)
        XCTAssertNil(exif.utcOffset)
        XCTAssertNil(exif.capturedAt)
    }
}
