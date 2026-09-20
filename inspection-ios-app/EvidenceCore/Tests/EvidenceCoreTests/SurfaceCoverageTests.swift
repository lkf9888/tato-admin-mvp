import XCTest
import simd
@testable import EvidenceCore

/// A car 4.6m long, 1.85m wide, nose along +X, at the origin.
private func car() -> VehicleFrame {
    VehicleFrame(centre: .zero, forward: SIMD3<Float>(1, 0, 0), length: 4.6, width: 1.85)
}

/// Standing `standOff` metres out from the car's skin at `azimuth` degrees,
/// at eye height, aimed at the panel in front of you.
///
/// Aimed at the nearest surface rather than at the car's centre, because that
/// is what a person does: you point the camera at the door you are looking
/// at, not at a point inside the engine bay.
private func shot(
    azimuth: Double,
    standOff: Float = 1.8,
    height: Float = 1.5,
    fieldOfView: Double = 68,
    on frame: VehicleFrame = car()
) -> Set<CoveragePatch> {
    let radians = Double(azimuth) * .pi / 180
    let (surface, normal) = CoverageProjection.surfacePoint(sector: radians, band: .body, of: frame)
    let position = surface + normal * standOff + SIMD3<Float>(0, height - Float(SurfaceBand.body.height), 0)
    return CoverageProjection.patches(
        seenFrom: position,
        looking: surface - position,
        horizontalFieldOfViewDegrees: fieldOfView,
        of: frame
    )
}

final class SurfaceCoverageTests: XCTestCase {

    // MARK: - What one photograph documents

    func testAPhotographCoversTheSideItFaces() {
        let patches = shot(azimuth: 0)
        let regions = Set(patches.map { SurfaceCoverage.region(ofSector: $0.sector, band: $0.band) })

        XCTAssertTrue(regions.contains(.front), "standing in front should cover the front")
        XCTAssertFalse(regions.contains(.rear), "and must not cover the far side of the car")
    }

    /// The whole point of painting rather than ticking: one shot is never
    /// enough, and the photographer can see that without being told.
    func testOneShotIsNowhereNearComplete() {
        var coverage = SurfaceCoverage()
        coverage.add(shot(azimuth: 0))
        XCTAssertLessThan(coverage.fraction, 0.25)
        XCTAssertFalse(coverage.fraction.isZero)
    }

    /// A panel photographed edge-on shows no damage, so it must not count.
    /// Without this rule a single wide shot down the length of the car would
    /// paint the entire flank green.
    func testGrazingAnglesDoNotCount() {
        let frame = car()
        // Standing off the nose but aimed straight down the side, so the far
        // doors fall inside the frame at a sliver.
        let position = frame.centre + frame.forward * 4 + frame.right * 0.9 + SIMD3<Float>(0, 1.5, 0)
        let patches = CoverageProjection.patches(
            seenFrom: position,
            looking: -frame.forward,
            horizontalFieldOfViewDegrees: 68,
            of: frame
        )
        let rearSectors = SurfaceCoverage.sectors(in: .rear)
        XCTAssertTrue(
            patches.allSatisfy { !rearSectors.contains($0.sector) },
            "the tail is 8m away and edge-on; it is not documented by this photo"
        )
    }

    func testTooFarAwayCountsForNothing() {
        XCTAssertTrue(shot(azimuth: 0, standOff: 12).isEmpty)
    }

    // MARK: - Walking around

    /// Sixteen shots around the car, which is what an unhurried walk-around
    /// looks like, should paint the sides but leave the roof red.
    func testAWalkAroundAtEyeLevelCoversTheSidesButNotTheRoof() {
        var coverage = SurfaceCoverage()
        for step in 0..<16 {
            coverage.add(shot(azimuth: Double(step) * 22.5))
        }

        XCTAssertGreaterThan(coverage.fraction(of: .front), 0.9)
        XCTAssertGreaterThan(coverage.fraction(of: .left), 0.9)
        XCTAssertGreaterThan(coverage.fraction(of: .rear), 0.9)
        XCTAssertGreaterThan(coverage.fraction(of: .right), 0.9)

        // The roof faces the sky. No amount of circling at eye level covers
        // it — which is how the overhead shot becomes necessary without
        // anybody naming it in a list.
        XCTAssertLessThan(coverage.fraction(of: .roof), 0.1)
        XCTAssertEqual(coverage.thinnestRegion(), .roof)
    }

    func testHoldingThePhoneOverheadCoversTheRoof() {
        var coverage = SurfaceCoverage()
        let frame = car()
        for step in 0..<8 {
            let radians = Float(Double(step) / 8 * 2 * .pi)
            let out = frame.forward * cos(radians) + frame.right * sin(radians)
            // Arms up, right at the car, camera aimed down.
            let position = frame.centre + out * 1.2 + SIMD3<Float>(0, 2.2, 0)
            coverage.add(CoverageProjection.patches(
                seenFrom: position,
                looking: SIMD3<Float>(0, -1, 0),
                horizontalFieldOfViewDegrees: 68,
                of: frame
            ))
        }
        XCTAssertGreaterThan(coverage.fraction(of: .roof), 0.5)
    }

    /// Where to send somebody next, which is the only instruction the screen
    /// ever gives.
    ///
    /// Asserted as a comparison rather than an absolute: one photograph
    /// spreads over a surprising span of the car, so "the far side is at
    /// zero" is a claim about the test's arithmetic, while "the far side is
    /// thinner than the near side" is the claim the feature rests on.
    func testTheThinnestRegionIsWhereYouHaveNotBeen() {
        var coverage = SurfaceCoverage()
        for azimuth in stride(from: -45.0, through: 45.0, by: 22.5) {
            coverage.add(shot(azimuth: azimuth))
        }
        XCTAssertGreaterThan(coverage.fraction(of: .front), 0.8)
        XCTAssertLessThan(coverage.fraction(of: .rear), coverage.fraction(of: .front))
        XCTAssertNotEqual(coverage.thinnestRegion(), .front)
    }

    func testMissingPatchesAreWhatIsLeftToPaint() {
        var coverage = SurfaceCoverage()
        XCTAssertEqual(coverage.missing().count, SurfaceCoverage.total)
        coverage.add(shot(azimuth: 0))
        XCTAssertEqual(coverage.missing().count, SurfaceCoverage.total - coverage.covered.count)
    }

    // MARK: - Inside the car

    /// Interior photographs are counted from where the phone is, so nobody
    /// has to declare what they are shooting.
    func testTheGeometryKnowsWhenYouAreSittingInTheCar() {
        let frame = car()
        XCTAssertTrue(frame.contains(SIMD3<Float>(0, 1.1, 0)), "in a seat, arm out")
        XCTAssertTrue(frame.contains(SIMD3<Float>(-1.2, 1.0, 0.3)), "in the back")
        XCTAssertFalse(frame.contains(SIMD3<Float>(4, 1.5, 0)), "standing in front of it")
        XCTAssertFalse(frame.contains(SIMD3<Float>(0, 2.3, 0)), "reaching over the roof")
        XCTAssertFalse(frame.contains(SIMD3<Float>(0, 0.1, 0)), "lying under it")
    }
}

final class ShootingProgressTests: XCTestCase {

    /// Before the first photograph the app must not name a region: nothing
    /// has been painted, so every region reads as empty and "go to the front"
    /// would be arbitrary. It says the thing that makes the app usable
    /// without instruction instead.
    func testTheFirstInstructionSaysThereIsNoWrongPlaceToStart() {
        let fresh = ShootingProgress(coverage: 0, exteriorShots: 0, interiorShots: 0, thinnestRegion: .front)
        XCTAssertEqual(fresh.instruction, "对着车拍第一张，从哪个角度开始都行")

        // Shooting, but the car has not been found yet.
        let searching = ShootingProgress(coverage: 0, exteriorShots: 3, interiorShots: 0, thinnestRegion: .front)
        XCTAssertEqual(searching.instruction, "绕着车继续拍")
    }

    func testAFreshSessionAsksForCoverageFirst() {
        let progress = ShootingProgress(coverage: 0.1, exteriorShots: 2, interiorShots: 0, thinnestRegion: .rear)
        XCTAssertFalse(progress.canFinish)
        XCTAssertEqual(progress.instruction, "还差车尾，走过去拍")
    }

    /// Ninety per cent, not a hundred. A tow bar, a roof box or a car parked
    /// against a wall leaves patches nobody can reach, and a photographer who
    /// cannot finish goes back to the camera app.
    func testTheFinishButtonUnlocksBelowFullCoverage() {
        let short = ShootingProgress(coverage: 0.88, exteriorShots: 20, interiorShots: 10)
        let enough = ShootingProgress(coverage: 0.91, exteriorShots: 20, interiorShots: 10)
        XCTAssertFalse(short.canFinish)
        XCTAssertTrue(enough.canFinish)
    }

    func testTuroFloorsStillApplyEvenWhenTheCarIsCovered() {
        // Four wide shots from the corners can paint a lot of car.
        let wideOnly = ShootingProgress(coverage: 0.95, exteriorShots: 6, interiorShots: 10)
        XCTAssertFalse(wideOnly.canFinish)
        XCTAssertEqual(wideOnly.instruction, "再拍 9 张外观，站近一点")

        let noInterior = ShootingProgress(coverage: 0.95, exteriorShots: 20, interiorShots: 3)
        XCTAssertFalse(noInterior.canFinish)
        XCTAssertEqual(noInterior.instruction, "拍车内，还差 5 张")
    }

    /// More photographs make a claim more likely to succeed, so nothing may
    /// tell the photographer they are done — only that they *may* stop.
    func testPastTheFloorItAsksForMoreRatherThanDeclaringVictory() {
        let done = ShootingProgress(coverage: 0.97, exteriorShots: 30, interiorShots: 12)
        XCTAssertTrue(done.canFinish)
        XCTAssertTrue(done.instruction.contains("多拍"), done.instruction)
        XCTAssertFalse(done.instruction.contains("完成"))
    }

    /// There is no ceiling anywhere: a hundred photographs is a better
    /// session than twenty-four, and the model must not disagree.
    func testThereIsNoUpperBound() {
        let many = ShootingProgress(coverage: 1.0, exteriorShots: 120, interiorShots: 40)
        XCTAssertTrue(many.canFinish)
        XCTAssertTrue(many.outstanding.isEmpty)
        XCTAssertEqual(many.totalShots, 160)
    }
}
