import XCTest
import simd
@testable import EvidenceCore

/// A hollow box standing on the ground, which is what a LiDAR mesh of a car
/// amounts to once you stop admiring it.
private func carPointCloud(
    centre: SIMD3<Float> = .zero,
    headingDegrees: Float = 0,
    length: Float = 4.6,
    width: Float = 1.85,
    height: Float = 1.45,
    jitter: Float = 0
) -> [SIMD3<Float>] {
    var generator = SystemRandomNumberGenerator()
    func wobble() -> Float {
        jitter == 0 ? 0 : Float.random(in: -jitter...jitter, using: &generator)
    }

    var local: [SIMD3<Float>] = []
    let steps = 24
    for i in 0...steps {
        let t = Float(i) / Float(steps)
        let alongX = -length / 2 + t * length
        let alongZ = -width / 2 + t * width
        for j in 0...steps {
            let y = Float(j) / Float(steps) * height
            local.append(SIMD3(length / 2, y, alongZ))   // nose
            local.append(SIMD3(-length / 2, y, alongZ))  // tail
            local.append(SIMD3(alongX, y, width / 2))    // right flank
            local.append(SIMD3(alongX, y, -width / 2))   // left flank
        }
        for j in 0...steps {
            let z = -width / 2 + Float(j) / Float(steps) * width
            local.append(SIMD3(alongX, height, z))       // roof
        }
    }

    let radians = headingDegrees * .pi / 180
    return local.map { point in
        SIMD3(
            centre.x + point.x * cos(radians) - point.z * sin(radians) + wobble(),
            centre.y + point.y + wobble(),
            centre.z + point.x * sin(radians) + point.z * cos(radians) + wobble()
        )
    }
}

final class VehicleFrameFitterTests: XCTestCase {

    func testRecoversTheCarAtAnyHeading() throws {
        for heading in stride(from: Float(0), to: 360, by: 23) {
            let radians = heading * .pi / 180
            let expected = SIMD3<Float>(cos(radians), 0, sin(radians))
            let cloud = carPointCloud(headingDegrees: heading)

            let frame = try XCTUnwrap(
                VehicleFrameFitter.fit(points: cloud, groundY: 0, observedFrom: expected * 6),
                "no fit at heading \(heading)"
            )

            XCTAssertEqual(frame.length, 4.6, accuracy: 0.15, "length at heading \(heading)")
            XCTAssertEqual(frame.width, 1.85, accuracy: 0.15, "width at heading \(heading)")
            XCTAssertEqual(Double(simd_dot(frame.forward, expected)), 1.0, accuracy: 0.02,
                           "forward at heading \(heading)")
        }
    }

    /// The thing PCA cannot do. A line has no direction and a car's mesh is
    /// too symmetrical to tell a bonnet from a boot, so the photographer's own
    /// position at calibration time decides which end is the front.
    func testTheObserverDecidesWhichEndIsTheNose() throws {
        let cloud = carPointCloud()

        let fromTheFront = try XCTUnwrap(
            VehicleFrameFitter.fit(points: cloud, groundY: 0, observedFrom: SIMD3(6, 1.5, 2))
        )
        let fromTheBack = try XCTUnwrap(
            VehicleFrameFitter.fit(points: cloud, groundY: 0, observedFrom: SIMD3(-6, 1.5, 2))
        )

        XCTAssertEqual(Double(fromTheFront.forward.x), 1.0, accuracy: 0.02)
        XCTAssertEqual(Double(fromTheBack.forward.x), -1.0, accuracy: 0.02,
                       "standing behind the car, the fit points the other way")
    }

    /// Meshes come with the floor and, indoors, the ceiling attached.
    func testIgnoresTheGroundAndTheCeiling() throws {
        var cloud = carPointCloud()
        for x in stride(from: Float(-8), through: 8, by: 0.25) {
            for z in stride(from: Float(-8), through: 8, by: 0.25) {
                cloud.append(SIMD3(x, 0.02, z))   // car park floor
                cloud.append(SIMD3(x, 2.6, z))    // car park ceiling
            }
        }

        let frame = try XCTUnwrap(VehicleFrameFitter.fit(points: cloud, groundY: 0, observedFrom: SIMD3(6, 1.5, 0)))
        XCTAssertEqual(frame.length, 4.6, accuracy: 0.2)
        XCTAssertEqual(frame.width, 1.85, accuracy: 0.2)
    }

    func testSurvivesAMeasurementThatIsNotPerfect() throws {
        let frame = try XCTUnwrap(
            VehicleFrameFitter.fit(points: carPointCloud(headingDegrees: 31, jitter: 0.04),
                                   groundY: 0, observedFrom: SIMD3(5, 1.5, 3))
        )
        XCTAssertEqual(frame.length, 4.6, accuracy: 0.25)
        XCTAssertEqual(frame.width, 1.85, accuracy: 0.25)
    }

    /// Refusing to fit is a feature. Guiding a whole walk-around against a
    /// wall is worse than asking somebody to mark the car by hand.
    func testRefusesThingsThatAreNotCars() {
        var wall: [SIMD3<Float>] = []
        for x in stride(from: Float(-6), through: 6, by: 0.1) {
            for y in stride(from: Float(0.3), through: 2.0, by: 0.1) {
                wall.append(SIMD3(x, y, 3))
            }
        }
        XCTAssertNil(VehicleFrameFitter.fit(points: wall, groundY: 0, observedFrom: .zero),
                     "a 12m wall is not a car")

        let van = carPointCloud(length: 7.4, width: 2.1, height: 2.6)
        XCTAssertNil(VehicleFrameFitter.fit(points: van, groundY: 0, observedFrom: SIMD3(8, 1.5, 0)),
                     "too long to be the car in front of you")

        XCTAssertNil(VehicleFrameFitter.fit(points: Array(carPointCloud().prefix(10)),
                                            groundY: 0, observedFrom: SIMD3(6, 1.5, 0)),
                     "ten points is not a measurement")
    }

    /// End to end: fit the car off a noisy cloud, then walk around the
    /// fitted frame and watch the surface get painted. This is the LiDAR
    /// path, minus the LiDAR.
    func testAFittedFrameDrivesCoverage() throws {
        let heading: Float = 117
        let radians = heading * .pi / 180
        let cloud = carPointCloud(centre: SIMD3(12, 0, -4), headingDegrees: heading, jitter: 0.03)
        let observer = SIMD3<Float>(12, 1.5, -4) + SIMD3(cos(radians), 0, sin(radians)) * 6

        let frame = try XCTUnwrap(VehicleFrameFitter.fit(points: cloud, groundY: 0, observedFrom: observer))

        var coverage = SurfaceCoverage()
        for step in 0..<16 {
            let angle = Double(step) / 16 * 2 * .pi
            let (surface, normal) = CoverageProjection.surfacePoint(sector: angle, band: .body, of: frame)
            let position = surface + normal * 1.8 + SIMD3<Float>(0, 0.55, 0)
            coverage.add(CoverageProjection.patches(
                seenFrom: position, looking: surface - position,
                horizontalFieldOfViewDegrees: 68, of: frame
            ))
        }
        XCTAssertGreaterThan(coverage.fraction, 0.6, "a walk around a fitted car should paint most of it")
        XCTAssertLessThan(coverage.roofFraction, 0.1, "except the roof")
    }
}

final class BearingTests: XCTestCase {

    /// Facing along -Z, which is where an ARKit camera looks by default.
    private let facing = SIMD3<Float>(0, 0, -1)
    private let standing = SIMD3<Float>.zero

    func testTellsLeftFromRight() throws {
        let cases: [(SIMD3<Float>, Double, String)] = [
            (SIMD3(0, 0, -5), 0, "straight ahead"),
            (SIMD3(5, 0, 0), 90, "to the right"),
            (SIMD3(-5, 0, 0), -90, "to the left"),
            (SIMD3(0, 0, 5), 180, "behind"),
        ]
        for (target, expected, description) in cases {
            let bearing = try XCTUnwrap(Bearing.relative(to: target, from: standing, facing: facing))
            XCTAssertEqual(abs(bearing), abs(expected), accuracy: 0.01, description)
            if expected != 0 && abs(expected) != 180 {
                XCTAssertEqual(bearing.sign, expected.sign, description)
            }
        }
    }

    /// Height is a separate instruction. Folding it in gives an arrow that
    /// points at the ground.
    func testIgnoresHowHighTheTargetIs() throws {
        let low = try XCTUnwrap(Bearing.relative(to: SIMD3(5, -2, 0), from: standing, facing: facing))
        let high = try XCTUnwrap(Bearing.relative(to: SIMD3(5, 3, 0), from: standing, facing: facing))
        XCTAssertEqual(low, high, accuracy: 0.01)
    }

    func testNoBearingWhenYouAreAlreadyThere() {
        XCTAssertNil(Bearing.relative(to: SIMD3(0.01, 0, 0.01), from: standing, facing: facing))
    }

}

// MARK: - The garage

/// Builds a filled box of points, the way a depth mesh sees a solid object.
private func slab(
    centre: SIMD3<Float>, length: Float, width: Float, height: Float, step: Float = 0.12
) -> [SIMD3<Float>] {
    var points: [SIMD3<Float>] = []
    var x = -length / 2
    while x <= length / 2 {
        var z = -width / 2
        while z <= width / 2 {
            var y: Float = 0
            while y <= height {
                // Surfaces only: a mesh has no interior.
                let onShell = abs(x) > length / 2 - step || abs(z) > width / 2 - step || y > height - step
                if onShell { points.append(centre + SIMD3(x, y, z)) }
                y += step
            }
            z += step
        }
        x += step
    }
    return points
}

/// The session that started this: a car in a garage with a metal shelving
/// unit alongside it. Everything sits in the same 0.25–2.2m height band, so
/// the old filter handed all of it to PCA, which duly found the axis of the
/// room. The box came back 6.0 by 2.4 metres, passed `isPlausible`, and the
/// photographer circled the real car for thirty-one photographs while the
/// score sat at 42%.
final class GarageFitTests: XCTestCase {

    private let car = slab(centre: SIMD3(0, 0, 0), length: 4.5, width: 1.8, height: 1.5)
    private let shelving = slab(centre: SIMD3(0, 0, 1.7), length: 3.4, width: 0.5, height: 2.0)
    private let wall = slab(centre: SIMD3(0, 0, 4.0), length: 9.0, width: 0.2, height: 2.4)

    /// Standing beside the car, pointing at it.
    private let observer = SIMD3<Float>(0, 1.5, -2.4)
    private let looking = SIMD3<Float>(0, -0.2, 1)

    func testItFindsTheCarAndNotTheGarage() throws {
        let frame = try XCTUnwrap(
            VehicleFrameFitter.fit(
                points: car + shelving + wall,
                groundY: 0,
                observedFrom: observer,
                looking: looking
            )
        )
        XCTAssertEqual(frame.length, 4.5, accuracy: 0.4, "fitted something other than the car")
        XCTAssertEqual(frame.width, 1.8, accuracy: 0.4)
        XCTAssertLessThan(simd_length(frame.centre - SIMD3<Float>(0, 0, 0)), 0.5)
    }

    /// The exact failure, asserted directly: a box wide enough to have
    /// swallowed the shelving must never come back.
    func testItNeverReturnsTheCarPlusTheShelving() throws {
        let frame = try XCTUnwrap(
            VehicleFrameFitter.fit(
                points: car + shelving, groundY: 0, observedFrom: observer, looking: looking
            )
        )
        XCTAssertLessThan(frame.width, 2.2, "the shelving is inside the box again")
    }

    /// Pointing away from the car at the wall must not produce a car-shaped
    /// answer built out of wall.
    func testLookingAtTheWallFindsNoCar() {
        let away = SIMD3<Float>(0, -0.1, 1)
        let fromFarSide = SIMD3<Float>(0, 1.5, 2.0)
        let frame = VehicleFrameFitter.fit(
            points: wall, groundY: 0, observedFrom: fromFarSide, looking: away
        )
        XCTAssertNil(frame)
    }

    /// How close something has to be before it becomes part of the car.
    ///
    /// Measured, so the limit is a known quantity rather than a hope: from a
    /// 0.2m gap outwards the fit is the car's own 1.8m. At 0.1m it merges —
    /// and that is the honest answer, not a bug to chase. A car's mesh is
    /// full of holes where the paint and the glass returned no infrared, so
    /// anything ten centimetres off the flank is inside the noise of the car
    /// itself. Nobody parks a shelf that close to a car they are inspecting.
    func testHowCloseSomethingHasToBeBeforeItCounts() throws {
        for gap in [Float(0.2), 0.3, 0.5, 0.9] {
            let shelf = slab(
                centre: SIMD3(0, 0, 0.9 + gap + 0.25), length: 3.4, width: 0.5, height: 2.0
            )
            let frame = try XCTUnwrap(
                VehicleFrameFitter.fit(
                    points: car + shelf, groundY: 0, observedFrom: observer, looking: looking
                ),
                "no fit at \(gap)m"
            )
            XCTAssertEqual(frame.width, 1.8, accuracy: 0.3, "merged with shelving \(gap)m away")
        }
    }
}
