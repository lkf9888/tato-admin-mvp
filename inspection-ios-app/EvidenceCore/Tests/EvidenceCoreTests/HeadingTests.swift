import XCTest
import simd
@testable import EvidenceCore

/// A phone held upright in portrait, screen towards the photographer, turned
/// `yaw` degrees counter-clockwise about the vertical: the posture of every
/// photograph in a walk-around. Returns the device-to-reference rotation and
/// gravity as the device itself would report it.
private func uprightPhone(yaw: Double, pitchDown: Double = 0) -> (matrix: simd_double3x3, gravity: SIMD3<Double>) {
    func rz(_ degrees: Double) -> simd_double3x3 {
        let a = degrees * .pi / 180
        return simd_double3x3(rows: [
            SIMD3(cos(a), -sin(a), 0), SIMD3(sin(a), cos(a), 0), SIMD3(0, 0, 1),
        ])
    }
    func rx(_ degrees: Double) -> simd_double3x3 {
        let a = degrees * .pi / 180
        return simd_double3x3(rows: [
            SIMD3(1, 0, 0), SIMD3(0, cos(a), -sin(a)), SIMD3(0, sin(a), cos(a)),
        ])
    }
    // Upright is a quarter turn about the device's x axis away from lying
    // flat; tipping the top of the phone forward points the camera down.
    let deviceToReference = rz(yaw) * rx(90 - pitchDown)
    let gravity = deviceToReference.transpose * SIMD3<Double>(0, 0, -9.81)
    return (deviceToReference, gravity)
}

private func rows(_ m: simd_double3x3) -> (SIMD3<Double>, SIMD3<Double>, SIMD3<Double>) {
    let t = m.transpose   // columns of the transpose are the rows of m
    return (t.columns.0, t.columns.1, t.columns.2)
}

final class CameraHeadingTests: XCTestCase {

    /// ⚠️ The test the whole design leans on. Core Motion does not document
    /// which way its matrix maps, and the two readings are transposes of each
    /// other. The heading must come out the same whichever one Apple hands
    /// over — and it must actually move as the photographer turns.
    func testItDoesNotMatterWhichWayRoundCoreMotionMeantTheMatrix() throws {
        for yaw in stride(from: 0.0, to: 360, by: 30) {
            let phone = uprightPhone(yaw: yaw)
            let asGiven = try XCTUnwrap(CameraHeading.degrees(rows: rows(phone.matrix), gravity: phone.gravity))
            let transposed = try XCTUnwrap(
                CameraHeading.degrees(rows: rows(phone.matrix.transpose), gravity: phone.gravity)
            )
            XCTAssertEqual(asGiven, transposed, accuracy: 1e-6, "yaw \(yaw)")
        }
    }

    /// Turning the body a quarter turn turns the heading a quarter turn, the
    /// same way round. If this ever stays put, the matrix went through the
    /// wrong way and the ring will never fill.
    func testTurningThePhoneTurnsTheHeading() throws {
        let start = uprightPhone(yaw: 10)
        let turned = uprightPhone(yaw: 100)
        let a = try XCTUnwrap(CameraHeading.degrees(rows: rows(start.matrix), gravity: start.gravity))
        let b = try XCTUnwrap(CameraHeading.degrees(rows: rows(turned.matrix), gravity: turned.gravity))
        XCTAssertEqual(CameraHeading.difference(from: a, to: b), 90, accuracy: 1e-6)
    }

    /// A wheel is photographed with the phone tipped well down, and it still
    /// faces a side of the car.
    func testAPhoneTippedDownAtAWheelStillHasAHeading() {
        let phone = uprightPhone(yaw: 40, pitchDown: 50)
        XCTAssertNotNil(CameraHeading.degrees(rows: rows(phone.matrix), gravity: phone.gravity))
    }

    /// A phone pointed at the floor faces no side of anything.
    func testAPhonePointedAtTheFloorHasNoHeading() {
        let phone = uprightPhone(yaw: 40, pitchDown: 85)
        XCTAssertNil(CameraHeading.degrees(rows: rows(phone.matrix), gravity: phone.gravity))
    }
}

final class HeadingCoverageTests: XCTestCase {

    func testOnePhotographFillsASliceNotTheRing() {
        var coverage = HeadingCoverage()
        coverage.record(heading: 90, spreadDegrees: 27)
        XCTAssertGreaterThan(coverage.fraction, 0)
        XCTAssertLessThan(coverage.fraction, 0.3)
    }

    /// Eight photographs, one from each side and corner, is a walk round.
    func testGoingRoundFillsTheRing() {
        var coverage = HeadingCoverage()
        for heading in stride(from: 0.0, to: 360, by: 45) {
            coverage.record(heading: heading, spreadDegrees: 27)
        }
        XCTAssertEqual(coverage.fraction, 1, accuracy: 1e-9)
        XCTAssertNil(coverage.gapBearing(from: 0))
    }

    /// Twenty photographs of the same door are twenty photographs, and the
    /// ring says so.
    func testStandingStillDoesNotFillTheRing() {
        var coverage = HeadingCoverage()
        for _ in 0..<20 { coverage.record(heading: 200, spreadDegrees: 27) }
        XCTAssertLessThan(coverage.fraction, 0.3)
    }

    /// The wider lens takes in more of the car from the same spot, and is
    /// credited with more — but never a quarter of the ring from one frame.
    func testTheWideLensCountsForMoreButNotForEverything() {
        XCTAssertGreaterThan(HeadingCoverage.spread(forFieldOfView: 105),
                             HeadingCoverage.spread(forFieldOfView: 54))
        XCTAssertLessThanOrEqual(HeadingCoverage.spread(forFieldOfView: 120), 45)
    }

    /// ⚠️ The hint's sign, pinned. Standing south of the car facing north
    /// (90°) with only the south already photographed from, the east side is
    /// the nearest gap on the right — and from the east you face west, 180°.
    /// So a gap that is counter-clockwise of where the camera points is a
    /// walk to the right, and the bearing to it is positive.
    func testAGapCounterClockwiseOfYouIsAWalkToYourRight() throws {
        var coverage = HeadingCoverage()
        // Photographed from the south and the west (facing north and east).
        coverage.record(heading: 90, spreadDegrees: 45)
        coverage.record(heading: 0, spreadDegrees: 45)
        coverage.record(heading: 330, spreadDegrees: 45)
        // The empty stretch now runs from about 135° round to 285°. Facing
        // north, its middle is behind and to the right.
        let bearing = try XCTUnwrap(coverage.gapBearing(from: 90))
        XCTAssertGreaterThan(bearing, 0)
        XCTAssertEqual(ShootingProgress.walkThisWay(bearing), "绕到车的另一边，那边还没拍")

        let nearer = try XCTUnwrap(coverage.gapBearing(from: 140))
        XCTAssertEqual(ShootingProgress.walkThisWay(nearer), "往你右边走，那边还没拍")
    }

    /// Survives a gap that straddles zero.
    func testAGapAcrossZeroIsOneGap() throws {
        var coverage = HeadingCoverage()
        coverage.record(heading: 90, spreadDegrees: 45)
        coverage.record(heading: 180, spreadDegrees: 45)
        coverage.record(heading: 225, spreadDegrees: 45)
        // Empty from about 270° through 0° to 45°: one run, middle near 340.
        let bearing = try XCTUnwrap(coverage.gapBearing(from: 340))
        XCTAssertEqual(abs(bearing), 0, accuracy: 25)
    }

    func testAManifestFromBeforeThisExistedStillOpens() throws {
        let json = "{\"sessionID\":\"S1\",\"kind\":\"checkin\",\"vehicleLabel\":\"\","
            + "\"staffLabel\":\"\",\"deviceModel\":\"iPhone\",\"appVersion\":\"0.1.0\","
            + "\"startedAt\":\"2026-09-21T00:00:00Z\",\"timeZoneIdentifier\":\"America/Vancouver\","
            + "\"records\":[],\"coverage\":{\"counts\":[]}}"
        let manifest = try JSONDecoder.evidence.decode(SessionManifest.self, from: Data(json.utf8))
        XCTAssertTrue(manifest.headings.isEmpty)
    }
}
