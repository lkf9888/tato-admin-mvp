import XCTest
import ImageIO
@testable import EvidenceCore

private func makeManifest(
    _ records: [CaptureRecord] = [],
    coverage: SurfaceCoverage = SurfaceCoverage()
) -> SessionManifest {
    SessionManifest(
        sessionID: "S9", kind: .checkin, vehicleLabel: "ABC 123", staffLabel: "Wei",
        deviceModel: "iPhone 16 Pro", appVersion: "Walkaround 0.1.0",
        startedAt: Date(timeIntervalSince1970: 1_789_000_000), timeZoneIdentifier: "America/Vancouver",
        records: records, coverage: coverage
    )
}

private func makeRecord(
    _ sequence: Int,
    region: CarRegion = .front,
    gaps: [EvidenceGap] = [],
    despite: [ImageQualityIssue] = [],
    accepted: Bool = true
) -> CaptureRecord {
    CaptureRecord(
        region: region, sequence: sequence,
        filename: String(format: "%03d-%@.jpg", sequence, region.rawValue),
        byteCount: 2_400_000, sha256: String(repeating: "a", count: 64),
        capturedAt: Date(timeIntervalSince1970: 1_789_000_000),
        quality: ImageQualityReport(laplacianVariance: 900, meanLuminance: 118, luminanceStdDev: 44,
                                    clippedHighlightFraction: 0.01, clippedShadowFraction: 0.02,
                                    issues: despite),
        evidence: EvidenceCheck(gaps: gaps), metadataPath: .writtenAtCapture,
        accepted: accepted, acceptedDespite: despite
    )
}

/// A session that has filled every step of the plan.
///
/// ⚠️ Built from `ShotStep` rather than from a hand-written count, so a step
/// added to the plan shows up here as a session that no longer finishes,
/// which is the truth. The coverage is filled in separately: only the
/// walk-around is graded against it, and only the three side bands count
/// towards the percentage — see `SurfaceCoverage.total`.
private func finishedSession(coverageFraction: Double = 1.0) -> SessionManifest {
    var coverage = SurfaceCoverage()
    var patches = Set<CoveragePatch>()
    let sideBands: [SurfaceBand] = [.sill, .body, .glass]
    let wanted = Int(Double(SurfaceCoverage.total) * coverageFraction)
    outer: for sector in 0..<SurfaceCoverage.sectorCount {
        for band in sideBands {
            if patches.count >= wanted { break outer }
            patches.insert(CoveragePatch(sector: sector, band: band))
        }
    }
    coverage.add(patches)

    var records: [CaptureRecord] = []
    for step in ShotStep.allCases {
        for _ in 0..<step.required {
            var record = makeRecord(records.count + 1, region: step.region ?? .front)
            record.step = step
            records.append(record)
        }
    }
    return makeManifest(records, coverage: coverage)
}

final class SessionReadinessTests: XCTestCase {

    func testAFreshSessionJustSaysKeepShooting() {
        let readiness = makeManifest([makeRecord(1)]).readiness()
        XCTAssertFalse(readiness.canFinish)
        XCTAssertEqual(readiness.blockers.count, 1)
    }

    func testACoveredSessionPastTheFloorsCanFinish() {
        let readiness = finishedSession().readiness()
        XCTAssertTrue(readiness.canFinish)
        XCTAssertTrue(readiness.warnings.isEmpty)
    }

    /// Underground car parks exist. None of these stops the job — they stop
    /// somebody walking off without knowing.
    func testTheThingsThatWarnRatherThanBlock() {
        var manifest = finishedSession()
        // ⚠️ Mutated in place rather than replaced. A fresh record carries no
        // step, and a session missing two walk-around photographs is a
        // session that cannot finish — which is not what this test is about.
        manifest.records[0].evidence = EvidenceCheck(gaps: [.noLocation])
        manifest.records[1].acceptedDespite = [.blurry]

        let readiness = manifest.readiness()
        XCTAssertTrue(readiness.canFinish)
        XCTAssertTrue(readiness.needsAcknowledgement)
        XCTAssertTrue(readiness.warnings.contains(.missingLocation(count: 1)))
        XCTAssertTrue(readiness.warnings.contains(.qualityOverridden(count: 1)))
    }

    /// Finishable at 90% still means a tenth of the car was never
    /// photographed, and the summary has to say so.
    func testPartialCoverageIsSaidOutLoudEvenWhenItPasses() {
        let readiness = finishedSession(coverageFraction: 0.93).readiness()
        XCTAssertTrue(readiness.canFinish)
        XCTAssertTrue(readiness.warnings.contains { warning in
            if case .partialCoverage = warning { return true }
            return false
        })
    }

    func testRejectedPhotographsDoNotCountTowardsTheFloors() {
        var manifest = finishedSession()
        manifest.records = manifest.records.map { record in
            var copy = record
            if copy.region == .interior { copy.accepted = false }
            return copy
        }
        XCTAssertEqual(manifest.interiorShots, 0)
        XCTAssertFalse(manifest.readiness().canFinish)
    }
}

final class LibraryMirrorBookkeepingTests: XCTestCase {

    /// ⚠️ Every photograph, not only the accepted ones. A photograph the
    /// quality gate turned down is still a photograph of this car at this
    /// moment, and the person who took it decides whether it is worth
    /// attaching to a claim — not the gate, and not us.
    func testARejectedPhotographStillHasToReachTheCameraRoll() {
        var manifest = finishedSession()
        manifest.records[0].accepted = false
        XCTAssertTrue(manifest.recordsNotInLibrary.contains { $0.filename == manifest.records[0].filename })
    }

    func testAPhotographWithAnAssetIsNoLongerOutstanding() {
        var manifest = finishedSession()
        XCTAssertEqual(manifest.recordsNotInLibrary.count, manifest.records.count)
        XCTAssertTrue(manifest.recordsInLibrary.isEmpty)

        for index in manifest.records.indices { manifest.records[index].libraryAssetID = "asset-\(index)" }
        XCTAssertTrue(manifest.recordsNotInLibrary.isEmpty)
        XCTAssertEqual(manifest.recordsInLibrary.count, manifest.records.count)
    }

    /// A manifest written before the camera roll copy existed has to keep
    /// opening. An archive that will not open is worse than one that has
    /// forgotten something — and the same goes for `closeUp`, the key this
    /// field's neighbour used to be called.
    func testAManifestFromAnOlderBuildStillDecodes() throws {
        let json = "{\"sessionID\":\"S1\",\"kind\":\"checkin\",\"vehicleLabel\":\"ABC 123\","
            + "\"staffLabel\":\"Wei\",\"deviceModel\":\"iPhone 16 Pro\",\"appVersion\":\"0.1.0\","
            + "\"startedAt\":\"2026-09-21T00:00:00Z\",\"timeZoneIdentifier\":\"America/Vancouver\","
            + "\"records\":[],\"coverage\":{\"counts\":[]}}"
        let manifest = try JSONDecoder.evidence.decode(SessionManifest.self, from: Data(json.utf8))
        XCTAssertEqual(manifest.sessionID, "S1")
        XCTAssertTrue(manifest.recordsNotInLibrary.isEmpty)
    }
}

final class ExportManifestTests: XCTestCase {

    func testListsEveryDigestAndTheFileItCovers() {
        let manifest = finishedSession()
        let text = ExportManifest.plainText(for: manifest)
        for record in manifest.acceptedRecords {
            XCTAssertTrue(text.contains(record.filename), "\(record.filename) is missing")
        }
        XCTAssertTrue(text.contains("ABC 123"))
        XCTAssertTrue(text.contains("Return from guest"))
        XCTAssertTrue(text.contains("33 exterior, 8 interior"), text)
    }

    /// A record that quietly omits its own weak points is worth less than one
    /// that lists them: the first thing an opponent does is look for what was
    /// left out.
    func testStatesTheWeakPointsInsteadOfBuryingThem() {
        var manifest = finishedSession(coverageFraction: 0.93)
        manifest.records[0].evidence = EvidenceCheck(gaps: [.noLocation])
        manifest.records[0].acceptedDespite = [.blurry]
        manifest.records[0].quality.issues = [.blurry]
        let text = ExportManifest.plainText(for: manifest)

        XCTAssertTrue(text.contains("no geolocation recorded"))
        XCTAssertTrue(text.contains("accepted despite: blurry"))
        XCTAssertTrue(text.contains("Least-covered area:"))
    }

    /// The audience is an adjuster or a lawyer, who will not read Chinese and
    /// will not run our software.
    func testIsInEnglishAndVerifiableWithStandardTools() {
        let text = ExportManifest.plainText(for: finishedSession())
        XCTAssertTrue(text.contains("SHA-256"))
        XCTAssertTrue(text.contains("\(String(repeating: "a", count: 64))  001-front.jpg"))
    }
}

final class ProvenanceTests: XCTestCase {

    private var manifest: SessionManifest { makeManifest([makeRecord(1), makeRecord(2, region: .rear)]) }
    private var knownDigest: String { String(repeating: "a", count: 64) }
    private var knownTime: Date { Date(timeIntervalSince1970: 1_789_000_000) }

    func testAMatchingDigestIsTheOriginal() {
        XCTAssertEqual(
            manifest.provenance(ofDigest: knownDigest, capturedAt: knownTime),
            .original(filename: "001-front.jpg", vehicleLabel: "ABC 123")
        )
    }

    /// The case that proves a delivery path re-encodes: taken at the same
    /// instant as one of ours, different bytes.
    func testSameMomentDifferentBytesIsAltered() {
        XCTAssertEqual(
            manifest.provenance(ofDigest: String(repeating: "b", count: 64), capturedAt: knownTime),
            .altered(filename: "001-front.jpg", vehicleLabel: "ABC 123")
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
