import XCTest
import simd
@testable import EvidenceCore

/// Points sampled off the skin of a RAV4-sized car, nose along +X, sitting on
/// the ground at y = 0, then thinned the way the tracker thins them.
private func carSkin(limit: Int = 400) -> [SIMD3<Float>] {
    let halfLength: Float = 2.3, halfWidth: Float = 0.93, height: Float = 1.68
    var points: [SIMD3<Float>] = []
    let step: Float = 0.06
    var x = -halfLength
    while x <= halfLength {
        var y: Float = 0.2
        while y <= height {
            points.append(SIMD3(x, y, halfWidth))
            points.append(SIMD3(x, y, -halfWidth))
            y += step
        }
        var z = -halfWidth
        while z <= halfWidth {
            points.append(SIMD3(x, height, z))
            z += step
        }
        x += step
    }
    var z = -halfWidth
    while z <= halfWidth {
        var y: Float = 0.2
        while y <= height {
            points.append(SIMD3(halfLength, y, z))
            points.append(SIMD3(-halfLength, y, z))
            y += step
        }
        z += step
    }
    guard points.count > limit else { return points }
    let stride = Double(points.count) / Double(limit)
    return (0..<limit).map { points[Int(Double($0) * stride)] }
}

final class CloseUpFramingTests: XCTestCase {

    /// ⚠️ The photograph from the car park: standing at the front wing of a
    /// 4Runner, about a metre out, the bonnet and one headlight filling the
    /// whole frame. The app said "这张里看不到车" and refused to count it,
    /// over and over, from the same spot.
    func testAPhotographWithNothingButCarInItCountsAsShowingTheCar() {
        let points = carSkin()
        let position = SIMD3<Float>(3.1, 1.25, -1.35)
        let direction = simd_normalize(SIMD3<Float>(1.9, 0.85, -0.55) - position)

        let reading = CarInFrame.read(
            points: points, from: position, looking: direction,
            horizontalFieldOfViewDegrees: 54
        )
        XCTAssertTrue(reading.showsTheCar, "only \(reading.pointsInFrame) points landed")
        XCTAssertGreaterThan(reading.pointsInFrame, CarInFrame.minimumPoints)
    }

    /// ⚠️ The same close-up with a cloud so thin that the old area test could
    /// not have passed it. Four hundred points over a whole vehicle is about
    /// one every ten centimetres, and a frame filled by one wing holds only a
    /// handful of them — which is exactly when the car fills the *most* of
    /// the picture. The gate has to survive that, because that is the
    /// photograph an assessor wants.
    func testASparseCloudStillCountsWhenTheCarFillsTheFrame() {
        let points = carSkin(limit: 120)
        let position = SIMD3<Float>(3.1, 1.25, -1.35)
        let direction = simd_normalize(SIMD3<Float>(1.9, 0.85, -0.55) - position)

        let reading = CarInFrame.read(
            points: points, from: position, looking: direction,
            horizontalFieldOfViewDegrees: 54
        )
        XCTAssertTrue(reading.showsTheCar, "only \(reading.pointsInFrame) points landed")
    }

    /// And the one this gate exists for, from the same walk-around: standing
    /// beside the car, pointing the phone at the ground.
    func testTheGarageFloorStillDoesNotCount() {
        let points = carSkin()
        let position = SIMD3<Float>(0, 1.4, -2.2)
        let direction = simd_normalize(SIMD3<Float>(0, -1, -0.35))

        let reading = CarInFrame.read(
            points: points, from: position, looking: direction,
            horizontalFieldOfViewDegrees: 54
        )
        XCTAssertFalse(reading.showsTheCar, "\(reading.pointsInFrame) points landed")
        XCTAssertEqual(reading.pointsInFrame, 0)
    }
}
