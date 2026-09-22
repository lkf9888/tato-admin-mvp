import XCTest
import simd
@testable import EvidenceCore

final class CarInFrameTests: XCTestCase {

    /// Points scattered over a car-sized box at the origin.
    private let car: [SIMD3<Float>] = {
        var points: [SIMD3<Float>] = []
        for i in 0..<12 {
            for j in 0..<6 {
                for k in 0..<4 {
                    points.append(SIMD3(
                        -2.3 + Float(i) * 0.42, 0.2 + Float(k) * 0.45, -0.93 + Float(j) * 0.37
                    ))
                }
            }
        }
        return points
    }()

    func testStandingBackAndPhotographingTheCarSeesTheCar() {
        let reading = CarInFrame.read(
            points: car, from: SIMD3(0, 1.5, 4), looking: SIMD3(0, -0.2, -1),
            horizontalFieldOfViewDegrees: 54
        )
        XCTAssertTrue(reading.showsTheCar, "share was \(reading.share)")
        XCTAssertGreaterThan(reading.visible, 0.5)
    }

    /// The photograph that started this: pointed at the floor while walking.
    func testPhotographingTheFloorDoesNotCount() {
        let reading = CarInFrame.read(
            points: car, from: SIMD3(0, 1.5, 4), looking: SIMD3(0, -1, -0.15),
            horizontalFieldOfViewDegrees: 54
        )
        XCTAssertFalse(reading.showsTheCar, "a picture of the ground counted as a car photograph")
    }

    func testTurningAwayFromTheCarDoesNotCount() {
        let reading = CarInFrame.read(
            points: car, from: SIMD3(0, 1.5, 4), looking: SIMD3(0, 0, 1),
            horizontalFieldOfViewDegrees: 54
        )
        XCTAssertEqual(reading.visible, 0)
        XCTAssertFalse(reading.showsTheCar)
    }

    /// A close-up of one wheel arch is real evidence and has to pass, which
    /// is why the bar is where it is rather than higher.
    func testACloseUpOfOnePartStillCounts() {
        let reading = CarInFrame.read(
            points: car, from: SIMD3(1.4, 0.6, 1.6), looking: SIMD3(0, -0.15, -1),
            horizontalFieldOfViewDegrees: 54
        )
        XCTAssertTrue(reading.showsTheCar, "share was \(reading.share)")
    }

    func testNothingScannedMeansNoOpinion() {
        let reading = CarInFrame.read(
            points: [], from: .zero, looking: SIMD3(0, 0, 1), horizontalFieldOfViewDegrees: 54
        )
        XCTAssertEqual(reading.share, 0)
    }
}
