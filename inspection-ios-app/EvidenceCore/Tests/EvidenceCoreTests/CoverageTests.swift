import XCTest
import simd
@testable import EvidenceCore

/// A car 4.6m long and 1.85m wide, nose pointing along +X, parked at the
/// world origin.
private func testCar(headingDegrees: Float = 0) -> VehicleFrame {
    let radians = headingDegrees * .pi / 180
    return VehicleFrame(
        centre: .zero,
        forward: SIMD3<Float>(cos(radians), 0, sin(radians)),
        length: 4.6,
        width: 1.85
    )
}

final class VehicleGeometryTests: XCTestCase {

    /// The convention the whole shot plan is written against: 0° off the
    /// bonnet, 90° at the right flank.
    func testAzimuthConvention() {
        let car = testCar()
        let cases: [(SIMD3<Float>, Double, String)] = [
            (SIMD3(5, 1.5, 0), 0, "ahead of the bonnet"),
            (SIMD3(0, 1.5, 5), 90, "off the right flank"),
            (SIMD3(-5, 1.5, 0), 180, "behind the boot"),
            (SIMD3(0, 1.5, -5), 270, "off the left flank"),
        ]
        for (position, expected, description) in cases {
            XCTAssertEqual(car.placement(ofCameraAt: position).azimuthDegrees, expected,
                           accuracy: 0.01, description)
        }
    }

    /// "Two metres from the car" means two metres from the car, not from a
    /// point somewhere inside its engine bay.
    func testDistanceIsToTheBodyNotTheCentre() {
        let car = testCar()
        let ahead = car.placement(ofCameraAt: SIMD3(2.3 + 2.0, 1.5, 0))
        XCTAssertEqual(ahead.distance, 2.0, accuracy: 0.01)

        let beside = car.placement(ofCameraAt: SIMD3(0, 1.5, 0.925 + 2.0))
        XCTAssertEqual(beside.distance, 2.0, accuracy: 0.01)

        let leaningOnIt = car.placement(ofCameraAt: SIMD3(0, 1.5, 0))
        XCTAssertEqual(leaningOnIt.distance, 0, accuracy: 0.001)
    }

    func testHeightIsAboveTheGroundTheCarStandsOn() {
        let onASlope = VehicleFrame(centre: SIMD3(0, 12, 0), forward: SIMD3(1, 0, 0), length: 4.6, width: 1.85)
        XCTAssertEqual(onASlope.placement(ofCameraAt: SIMD3(5, 13.5, 0)).height, 1.5, accuracy: 0.001)
    }

    /// Every station in the plan must survive the round trip, at any heading.
    /// If this breaks, people get sent to the wrong side of the car.
    func testEveryStationRoundTrips() {
        for heading in stride(from: Float(0), to: 360, by: 37) {
            let car = testCar(headingDegrees: heading)
            for slot in ShotPlan.exterior {
                let station = try! XCTUnwrap(slot.station)
                let placement = car.placement(ofCameraAt: car.worldPosition(for: station))

                XCTAssertEqual(Angle.distance(placement.azimuthDegrees, station.azimuthDegrees), 0,
                               accuracy: 0.05, "\(slot.id) at heading \(heading)")
                XCTAssertEqual(placement.distance, station.distance.metres,
                               accuracy: 0.02, "\(slot.id) at heading \(heading)")
                XCTAssertEqual(placement.height, station.height.metres,
                               accuracy: 0.001, "\(slot.id) at heading \(heading)")
            }
        }
    }

    func testAnglesWrapRatherThanRunningOff() {
        XCTAssertEqual(Angle.distance(350, 10), 20, accuracy: 0.001)
        XCTAssertEqual(Angle.difference(from: 350, to: 10), 20, accuracy: 0.001)
        XCTAssertEqual(Angle.difference(from: 10, to: 350), -20, accuracy: 0.001)
        XCTAssertEqual(Angle.normalised(-90), 270, accuracy: 0.001)
    }
}

final class CoverageMatcherTests: XCTestCase {

    private let car = testCar()

    private func standing(at slotID: String) throws -> Placement {
        let slot = try XCTUnwrap(ShotPlan.slot(id: slotID))
        let station = try XCTUnwrap(slot.station)
        return car.placement(ofCameraAt: car.worldPosition(for: station))
    }

    func testStandingOnAStationMatchesIt() throws {
        for slot in ShotPlan.exterior {
            let placement = try standing(at: slot.id)
            XCTAssertEqual(
                CoverageMatcher.station(for: placement, among: ShotPlan.exterior)?.id,
                slot.id,
                "standing on \(slot.id) should match \(slot.id)"
            )
        }
    }

    /// The case that makes azimuth-only matching useless: 45° standing back
    /// and 60° crouched at the wheel are fifteen degrees apart, inside any
    /// workable angular tolerance. Height and distance are what tell them
    /// apart, and if they did not, half the walk-around would tick itself off
    /// from the wrong place.
    func testTheThreeQuarterAndTheWheelAreNotConfused() throws {
        let corner = try standing(at: "front_three_quarter_right")
        let wheel = try standing(at: "wheel_front_right")

        XCTAssertLessThan(Angle.distance(corner.azimuthDegrees, wheel.azimuthDegrees), 22.5,
                          "the premise: these two are within the angular tolerance of each other")

        XCTAssertEqual(CoverageMatcher.station(for: corner, among: ShotPlan.exterior)?.id,
                       "front_three_quarter_right")
        XCTAssertEqual(CoverageMatcher.station(for: wheel, among: ShotPlan.exterior)?.id,
                       "wheel_front_right")
    }

    /// The ring stations are 45° apart and the angular tolerance is half of
    /// that, so the sectors abut and there is no angle at which the app goes
    /// blank. Deliberate: a dead zone between stations is a person standing
    /// in a car park waiting for a phone to make up its mind.
    func testTheSectorsTileTheCircleWithNoDeadZone() {
        for azimuth in stride(from: 0.0, to: 360.0, by: 2.5) {
            let onTheRing = Placement(azimuthDegrees: azimuth, distance: 3.5, height: 1.5)
            XCTAssertNotNil(
                CoverageMatcher.station(for: onTheRing, among: ShotPlan.exterior),
                "nothing matches at \(azimuth)° on the ring"
            )
        }
    }

    /// Being loose about where somebody stands is not the same as matching
    /// anything. Somewhere no station is, matches nothing.
    func testAPlacementNowhereNearAStationMatchesNothing() {
        let cases: [(Placement, String)] = [
            (Placement(azimuthDegrees: 45, distance: 8.0, height: 1.5), "across the car park"),
            (Placement(azimuthDegrees: 45, distance: 3.5, height: 3.4), "up a ladder"),
            (Placement(azimuthDegrees: 90, distance: 0.6, height: 1.5), "at the flank, at arm's length"),
        ]
        for (placement, description) in cases {
            XCTAssertNil(CoverageMatcher.station(for: placement, among: ShotPlan.exterior), description)
        }
    }

    func testInteriorSlotsNeverMatchAPlacement() throws {
        let placement = try standing(at: "front")
        XCTAssertNil(CoverageMatcher.station(for: placement, among: ShotPlan.interior))
    }

    func testGuidanceTurnsTheShorterWay() {
        // Standing at 350°, sent to the station at 0°: ten degrees clockwise,
        // not three hundred and fifty anticlockwise.
        let placement = Placement(azimuthDegrees: 350, distance: 3.5, height: 1.5)
        let front = ShotPlan.slot(id: "front")!
        let guidance = CoverageMatcher.guidance(for: placement, outstanding: [front])

        XCTAssertEqual(guidance.nextSlot?.id, "front")
        XCTAssertEqual(try XCTUnwrap(guidance.turnDegrees), 10, accuracy: 0.01)
    }

    func testGuidanceTellsYouToCrouchAndStepIn() throws {
        // Standing tall and far back, sent to the wheel.
        let placement = Placement(azimuthDegrees: 60, distance: 3.5, height: 1.5)
        let wheel = try XCTUnwrap(ShotPlan.slot(id: "wheel_front_right"))
        let guidance = CoverageMatcher.guidance(for: placement, outstanding: [wheel])

        XCTAssertLessThan(try XCTUnwrap(guidance.distanceChange), 0, "should say come closer")
        XCTAssertLessThan(try XCTUnwrap(guidance.heightChange), 0, "should say crouch")
    }

    /// A retake late in the walk should not mean walking the whole ring
    /// again, so the next shot is the nearest outstanding one by angle.
    func testGuidanceSendsYouToTheNearestOutstandingShot() throws {
        let placement = try standing(at: "rear")
        let outstanding = [
            try XCTUnwrap(ShotPlan.slot(id: "front")),
            try XCTUnwrap(ShotPlan.slot(id: "rear_three_quarter_left")),
        ]
        let guidance = CoverageMatcher.guidance(for: placement, outstanding: outstanding)
        XCTAssertEqual(guidance.nextSlot?.id, "rear_three_quarter_left")
    }
}

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

    /// End to end: fit the car off the mesh, then walk the plan against the
    /// fitted frame. This is the LiDAR path, minus the LiDAR.
    func testAFittedFrameDrivesTheWholeShotPlan() throws {
        let heading: Float = 117
        let radians = heading * .pi / 180
        let cloud = carPointCloud(centre: SIMD3(12, 0, -4), headingDegrees: heading, jitter: 0.03)
        let observer = SIMD3<Float>(12, 1.5, -4) + SIMD3(cos(radians), 0, sin(radians)) * 6

        let frame = try XCTUnwrap(VehicleFrameFitter.fit(points: cloud, groundY: 0, observedFrom: observer))

        for slot in ShotPlan.exterior {
            let station = try XCTUnwrap(slot.station)
            let placement = frame.placement(ofCameraAt: frame.worldPosition(for: station))
            XCTAssertEqual(CoverageMatcher.station(for: placement, among: ShotPlan.exterior)?.id,
                           slot.id, "\(slot.id) against a fitted frame")
        }
    }
}

final class OffStationTrailTests: XCTestCase {

    private func record(slotID: String, stationVerified: Bool?) -> CaptureRecord {
        CaptureRecord(
            slotID: slotID, attempt: 1, filename: "\(slotID)-1.jpg", byteCount: 1,
            sha256: "x", capturedAt: Date(),
            quality: ImageQualityReport(laplacianVariance: 999, meanLuminance: 120,
                                        luminanceStdDev: 40, clippedHighlightFraction: 0,
                                        clippedShadowFraction: 0, issues: []),
            evidence: EvidenceCheck(gaps: []), metadataPath: .writtenAtCapture,
            accepted: true, stationVerified: stationVerified
        )
    }

    /// Four photographs of the same corner is the failure this whole engine
    /// exists to catch, and it has to be visible in the manifest afterwards.
    func testOffStationPhotographsAreCounted() {
        var manifest = SessionManifest(
            sessionID: "S3", kind: .checkin, vehicleLabel: "ABC 123", staffLabel: "Wei",
            deviceModel: "iPhone 16 Pro", appVersion: "0.1.0",
            startedAt: Date(), timeZoneIdentifier: "America/Vancouver"
        )
        manifest.records = [
            record(slotID: "front", stationVerified: true),
            record(slotID: "rear", stationVerified: false),
            record(slotID: "side_left", stationVerified: false),
            // Tracking was never available: says nothing either way, so it is
            // not counted as an offence.
            record(slotID: "side_right", stationVerified: nil),
        ]

        XCTAssertEqual(Set(manifest.recordsTakenOffStation.map(\.slotID)), ["rear", "side_left"])
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

    /// The reason this type exists: around-the-car and in-front-of-your-face
    /// are different frames, and the guidance must speak the second one.
    func testTheCarFrameAndTheBodyFrameDisagree() throws {
        let car = testCar()  // nose along +X
        let station = try XCTUnwrap(ShotPlan.slot(id: "front_three_quarter_right")?.station)

        // Standing in front of the bonnet, facing the car — so looking along -X.
        let position = SIMD3<Float>(6, 1.5, 0)
        let bearing = try XCTUnwrap(
            Bearing.relative(to: car.worldPosition(for: station), from: position, facing: SIMD3(-1, 0, 0))
        )

        let placement = car.placement(ofCameraAt: position)
        let aroundTheCar = Angle.difference(from: placement.azimuthDegrees, to: station.azimuthDegrees)

        XCTAssertGreaterThan(aroundTheCar, 0, "the station is clockwise around the car")
        XCTAssertLessThan(bearing, 0, "but it is to the photographer's left")
    }
}
