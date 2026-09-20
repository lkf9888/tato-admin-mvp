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


    func testEvaluationNeverTouchesTheFile() throws {
        let jpeg = TestImages.checkerboard()
        let digestBefore = EvidenceHash.sha256(jpeg)
        _ = try ImageQualityGate.evaluate(jpeg: jpeg)
        XCTAssertEqual(EvidenceHash.sha256(jpeg), digestBefore)
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
