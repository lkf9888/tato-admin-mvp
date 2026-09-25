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
/// Built from `ShotStep` rather than from a hand-written count, so a step
/// added to the plan shows up here as a gap, which is the truth. The ring of
/// directions is filled in separately, to whatever share the test asks for.
private func finishedSession(ringFraction: Double = 1.0) -> SessionManifest {
    var ring = HeadingCoverage()
    let wanted = Int((Double(HeadingCoverage.sectorCount) * ringFraction).rounded())
    for sector in 0..<wanted {
        ring.record(heading: HeadingCoverage.centre(ofSector: sector), spreadDegrees: 0)
    }

    var records: [CaptureRecord] = []
    for step in ShotStep.allCases {
        for _ in 0..<step.required {
            var record = makeRecord(records.count + 1, region: step.region)
            record.step = step
            records.append(record)
        }
    }
    var manifest = makeManifest(records)
    manifest.headingCoverage = ring
    return manifest
}

final class SessionReadinessTests: XCTestCase {

    /// ⚠️ One photograph is something to hand in. The gaps are listed, not
    /// enforced — this app guides, it does not hold anybody's work hostage
    /// to a checklist.
    func testOnePhotographCanBeHandedInWithItsGapsListed() {
        var record = makeRecord(1, region: .exterior)
        record.step = .walkAround
        let readiness = makeManifest([record]).readiness()
        XCTAssertTrue(readiness.canFinish)
        XCTAssertTrue(readiness.warnings.contains { warning in
            if case .planIncomplete(let missing) = warning {
                return missing.first == Requirement(step: .walkAround, shortBy: 19)
            }
            return false
        })
    }

    /// The only thing that stops a hand-in: there being nothing to hand in.
    func testAnEmptySessionIsTheOnlyOneThatCannotBeHandedIn() {
        XCTAssertFalse(makeManifest([]).readiness().canFinish)
    }

    func testAFullPlanAndAFullRingHaveNothingToSay() {
        let readiness = finishedSession().readiness()
        XCTAssertTrue(readiness.canFinish)
        XCTAssertTrue(readiness.warnings.isEmpty)
    }

    /// Underground car parks exist. None of these stops the job — they stop
    /// somebody walking off without knowing.
    func testTheThingsThatWarnRatherThanBlock() {
        var manifest = finishedSession()
        manifest.records[0].evidence = EvidenceCheck(gaps: [.noLocation])
        manifest.records[1].acceptedDespite = [.blurry]

        let readiness = manifest.readiness()
        XCTAssertTrue(readiness.canFinish)
        XCTAssertTrue(readiness.needsAcknowledgement)
        XCTAssertTrue(readiness.warnings.contains(.missingLocation(count: 1)))
        XCTAssertTrue(readiness.warnings.contains(.qualityOverridden(count: 1)))
    }

    /// A ring with a gap in it is worth a line on the finish page.
    func testAGapInTheRingIsSaidOutLoud() {
        let readiness = finishedSession(ringFraction: 0.75).readiness()
        XCTAssertTrue(readiness.canFinish)
        XCTAssertTrue(readiness.warnings.contains { warning in
            if case .partialCoverage = warning { return true }
            return false
        })
    }

    /// A phone with no motion sensor has no ring at all, and "0% of
    /// directions" would be a false alarm about a walk-around that happened.
    func testNoRingAtAllIsNotReportedAsAnEmptyOne() {
        let readiness = finishedSession(ringFraction: 0).readiness()
        XCTAssertFalse(readiness.warnings.contains { warning in
            if case .partialCoverage = warning { return true }
            return false
        })
    }

    func testRejectedPhotographsDoNotCountTowardsThePlan() {
        var manifest = finishedSession()
        manifest.records = manifest.records.map { record in
            var copy = record
            if copy.region == .interior { copy.accepted = false }
            return copy
        }
        XCTAssertEqual(manifest.interiorShots, 0)
        let readiness = manifest.readiness()
        XCTAssertTrue(readiness.canFinish)
        XCTAssertTrue(readiness.warnings.contains { warning in
            if case .planIncomplete(let missing) = warning {
                return missing.allSatisfy(\.step.isInterior) && !missing.isEmpty
            }
            return false
        })
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
        var manifest = finishedSession(ringFraction: 0.75)
        manifest.records[0].evidence = EvidenceCheck(gaps: [.noLocation])
        manifest.records[0].acceptedDespite = [.blurry]
        manifest.records[0].quality.issues = [.blurry]
        manifest.records.removeAll { $0.step == .wheels }
        let text = ExportManifest.plainText(for: manifest)

        XCTAssertTrue(text.contains("no geolocation recorded"))
        XCTAssertTrue(text.contains("accepted despite: blurry"))
        XCTAssertTrue(text.contains("75% of the directions around the vehicle"), text)
        XCTAssertTrue(text.contains("The guided shot list was not completed"), text)
        XCTAssertTrue(text.contains("wheels: 4 more"), text)
    }

    /// ⚠️ The ring is a motion-sensor figure, and the document an adjuster
    /// reads must not let it pass for a measurement of the car's surface.
    func testDoesNotDressTheRingUpAsSurfaceCoverage() {
        let text = ExportManifest.plainText(for: finishedSession())
        XCTAssertFalse(text.contains("of the vehicle's surface"), text)
        XCTAssertFalse(text.contains("Least-covered area"), text)
    }

    /// The audience is an adjuster or a lawyer, who will not read Chinese and
    /// will not run our software.
    func testIsInEnglishAndVerifiableWithStandardTools() {
        let text = ExportManifest.plainText(for: finishedSession())
        XCTAssertTrue(text.contains("SHA-256"))
        XCTAssertTrue(text.contains("\(String(repeating: "a", count: 64))  001-exterior.jpg"))
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
