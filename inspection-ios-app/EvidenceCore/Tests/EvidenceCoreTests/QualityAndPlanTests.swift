import XCTest
@testable import EvidenceCore

final class ImageQualityGateTests: XCTestCase {

    func testASharpFrameScoresFarAboveABlurredOne() throws {
        let sharpJPEG = TestImages.checkerboard(width: 320, height: 240)
        let blurredJPEG = TestImages.checkerboard(width: 320, height: 240, blurPasses: 6)

        let sharp = try ImageQualityGate.evaluate(jpeg: sharpJPEG)
        let blurred = try ImageQualityGate.evaluate(jpeg: blurredJPEG)
        XCTAssertGreaterThan(sharp.laplacianVariance, blurred.laplacianVariance * 4)

        // The verdict is checked against a bar derived from these very frames
        // rather than against `.provisional`. Provisional numbers are for real
        // cars in real light; asserting them over a synthetic checkerboard
        // would only be testing that two arbitrary constants still line up.
        let bar = ImageQualityThresholds(
            minLaplacianVariance: sharp.laplacianVariance / 2,
            maxClippedHighlightFraction: 1,
            maxClippedShadowFraction: 1,
            minLuminanceStdDev: 0
        )
        XCTAssertFalse(try ImageQualityGate.evaluate(jpeg: sharpJPEG, thresholds: bar).issues.contains(.blurry))
        XCTAssertTrue(try ImageQualityGate.evaluate(jpeg: blurredJPEG, thresholds: bar).issues.contains(.blurry))
    }

    /// Scores have to be comparable between a 12MP phone and a 48MP one, so
    /// every frame is measured at the same size before anything is decided.
    ///
    /// Both frames here are larger than `analysisMaxDimension`, which is the
    /// case for every phone the app supports. The cap only ever scales down —
    /// a frame smaller than it is measured at its own size — so a synthetic
    /// 600px image would not be normalised at all and would prove nothing.
    func testScoreIsStableAcrossSensorResolutions() throws {
        let twelveMegapixel = TestImages.checkerboard(width: 1600, height: 1200, cell: 20)
        let fortyEightMegapixel = TestImages.checkerboard(width: 3200, height: 2400, cell: 40)

        let small = try ImageQualityGate.evaluate(jpeg: twelveMegapixel)
        let large = try ImageQualityGate.evaluate(jpeg: fortyEightMegapixel)

        let ratio = small.laplacianVariance / max(large.laplacianVariance, 1)
        XCTAssertGreaterThan(ratio, 0.5)
        XCTAssertLessThan(ratio, 2.0)
    }

    func testFlatFrameReadsAsLowContrastNotAsSharp() throws {
        let flat = TestImages.checkerboard(cell: 4096)  // one solid tone
        let report = try ImageQualityGate.evaluate(jpeg: flat)

        XCTAssertTrue(report.issues.contains(.lowContrast))
        XCTAssertTrue(report.issues.contains(.blurry))
    }

    func testTheOdometerIsHeldToAStricterBar() {
        XCTAssertGreaterThan(
            ImageQualityThresholds.legibleText.minLaplacianVariance,
            ImageQualityThresholds.provisional.minLaplacianVariance
        )
        XCTAssertEqual(ShotPlan.slot(id: "odometer")?.thresholds, .legibleText)
        XCTAssertEqual(ShotPlan.slot(id: "front")?.thresholds, .provisional)
    }

    func testEvaluationNeverTouchesTheFile() throws {
        let jpeg = TestImages.checkerboard()
        let digestBefore = EvidenceHash.sha256(jpeg)
        _ = try ImageQualityGate.evaluate(jpeg: jpeg)
        XCTAssertEqual(EvidenceHash.sha256(jpeg), digestBefore)
    }
}

final class ShotPlanTests: XCTestCase {

    /// Turo's guidance for host trip photos is at least 15 exterior and at
    /// least 8 interior. These floors exist so a later tidy-up of the list
    /// cannot quietly drop the plan below what a claim needs.
    func testMeetsTuroPhotoCountFloors() {
        XCTAssertGreaterThanOrEqual(ShotPlan.exterior.count, 15)
        XCTAssertGreaterThanOrEqual(ShotPlan.interior.count, 8)
    }

    func testCapturesTheTwoReadingsEveryClaimAsksFor() {
        XCTAssertNotNil(ShotPlan.slot(id: "odometer"))
        XCTAssertNotNil(ShotPlan.slot(id: "fuel_gauge"))
        XCTAssertTrue(ShotPlan.slot(id: "odometer")!.requiresLegibleText)
        XCTAssertTrue(ShotPlan.slot(id: "fuel_gauge")!.requiresLegibleText)
    }

    /// Turo does not cover undercarriage damage and a phone cannot photograph
    /// one anyway. The lower bumpers and the ground under each tyre are what
    /// stands in for it.
    func testCoversLowerBumpersAndWheelsInsteadOfTheUndercarriage() {
        XCTAssertNotNil(ShotPlan.slot(id: "bumper_front_lower"))
        XCTAssertNotNil(ShotPlan.slot(id: "bumper_rear_lower"))
        XCTAssertEqual(ShotPlan.exterior.filter { $0.id.hasPrefix("wheel_") }.count, 4)
        XCTAssertTrue(ShotPlan.standard.allSatisfy { !$0.id.contains("undercarriage") })
    }

    func testEveryExteriorSlotHasAStationAndEveryInteriorSlotHasNone() {
        for slot in ShotPlan.exterior {
            XCTAssertNotNil(slot.station, "\(slot.id) needs a station for the coverage engine")
        }
        for slot in ShotPlan.interior {
            XCTAssertNil(slot.station, "\(slot.id) is inside the car and has no station")
        }
    }

    func testStationsRingTheWholeCar() {
        let azimuths = ShotPlan.exterior.compactMap { $0.station?.azimuthDegrees }
        for quadrant in stride(from: 0.0, to: 360.0, by: 90.0) {
            XCTAssertTrue(
                azimuths.contains { $0 >= quadrant && $0 < quadrant + 90 },
                "nothing is shot from the \(Int(quadrant))°–\(Int(quadrant) + 90)° quadrant"
            )
        }
    }

    /// The roof is taken with the phone over the photographer's head, where the
    /// screen cannot be seen. That slot has to be driven by speech and haptics.
    func testTheRoofIsTheHandsFreeSlot() {
        XCTAssertEqual(ShotPlan.standard.filter(\.handsFree).map(\.id), ["roof"])
        XCTAssertEqual(ShotPlan.slot(id: "roof")?.station?.height, .overhead)
    }

    func testSlotIdentifiersAreUnique() {
        XCTAssertEqual(Set(ShotPlan.standard.map(\.id)).count, ShotPlan.standard.count)
    }
}

final class EvidenceHashTests: XCTestCase {

    func testKnownVector() {
        XCTAssertEqual(
            EvidenceHash.sha256(Data("abc".utf8)),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
    }

    func testMatchesIgnoresCase() {
        let digest = EvidenceHash.sha256(Data("abc".utf8))
        XCTAssertTrue(EvidenceHash.matches(Data("abc".utf8), digest: digest.uppercased()))
        XCTAssertFalse(EvidenceHash.matches(Data("abd".utf8), digest: digest))
    }
}
