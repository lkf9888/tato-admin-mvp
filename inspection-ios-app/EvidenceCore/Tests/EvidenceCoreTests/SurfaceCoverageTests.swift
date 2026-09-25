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
        XCTAssertLessThan(coverage.roofFraction, 0.1)
        // ⚠️ And it is not what `thinnestRegion` answers, because that
        // question is "which way should this person walk" and no amount of
        // walking reaches a roof. Measured: a flawless ground-level
        // walk-around used to score exactly 75% and stop, against a finish
        // line of 90%.
        XCTAssertNotEqual(coverage.thinnestRegion(), .roof)
        XCTAssertEqual(coverage.fraction, 1.0, accuracy: 0.001, "the sides are done")
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

    /// `missing()` draws the model, so it spans every band including the
    /// roof — unlike `total`, which scores only what a walk can reach.
    func testMissingPatchesAreWhatIsLeftToPaint() {
        var coverage = SurfaceCoverage()
        let everything = SurfaceCoverage.sectorCount * SurfaceBand.allCases.count
        XCTAssertEqual(coverage.missing().count, everything)
        coverage.add(shot(azimuth: 0))
        XCTAssertEqual(coverage.missing().count, everything - coverage.covered.count)
        XCTAssertGreaterThan(everything, SurfaceCoverage.total, "the roof is drawn but not scored")
    }

    // MARK: - Confidence

    /// One photograph of a panel is a glimpse; two from different places is
    /// evidence. The middle colour on the model has to mean something.
    func testASecondSightingRaisesConfidence() {
        var coverage = SurfaceCoverage()
        let patch = CoveragePatch(sector: 0, band: .body)
        XCTAssertEqual(coverage.confidence(of: patch), 0)

        coverage.add([patch])
        XCTAssertEqual(coverage.confidence(of: patch), 0.5, accuracy: 0.001)
        XCTAssertTrue(coverage.covered.contains(patch), "one sighting already counts as covered")

        coverage.add([patch])
        XCTAssertEqual(coverage.confidence(of: patch), 1.0, accuracy: 0.001)

        coverage.add([patch])
        XCTAssertEqual(coverage.confidence(of: patch), 1.0, accuracy: 0.001, "it does not keep climbing")
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

/// A session with every step of the plan filled.
private func wholePlan(except skipped: ShotStep? = nil) -> [ShotStep: Int] {
    var counts: [ShotStep: Int] = [:]
    for step in ShotStep.allCases where step != skipped { counts[step] = step.required }
    return counts
}

private func progress(
    coverage: Double = 1.0,
    steps: [ShotStep: Int],
    bearing: Double? = nil
) -> ShootingProgress {
    let exterior = steps.filter { !$0.key.isInterior }.values.reduce(0, +)
    let interior = steps.filter { $0.key.isInterior }.values.reduce(0, +)
    return ShootingProgress(
        coverage: coverage, exteriorShots: exterior, interiorShots: interior,
        shotsByStep: steps, gapBearing: bearing
    )
}

final class ShootingProgressTests: XCTestCase {

    /// The plan is the order it is asked in, and the first thing anybody sees
    /// is the walk-around. No photograph has to be declared, tapped or
    /// chosen first.
    func testItOpensOnTheWalkAround() {
        let fresh = progress(coverage: 0, steps: [:], bearing: -90)
        XCTAssertEqual(fresh.currentStep, .walkAround)
        XCTAssertEqual(fresh.instruction, ShotStep.walkAround.hintZH)
        XCTAssertFalse(fresh.planComplete)
    }

    /// ⚠️ A guide, not a gate. Twenty photographs advance the walk-around
    /// whatever the ring says. It used to hold the step until a surface model
    /// agreed the car had been photographed from nine-tenths of the way
    /// round, and on a real car that meant being told to photograph the rear
    /// while photographing the rear.
    func testStepsAdvanceOnTheirCountAlone() {
        let stoodStill = progress(coverage: 0.2, steps: [.walkAround: 20], bearing: 40)
        XCTAssertEqual(stoodStill.currentStep, .bumperCorners)
    }

    func testTheStepsAreAskedForInOrder() {
        var counts: [ShotStep: Int] = [:]
        for step in ShotStep.allCases {
            XCTAssertEqual(progress(steps: counts).currentStep, step)
            counts[step] = step.required
        }
        XCTAssertTrue(progress(steps: counts).planComplete)
    }

    /// ⚠️ One photograph is something to hand in. The plan says what would
    /// make the session better; it does not hold the work hostage.
    func testNothingInThePlanStopsAHandIn() {
        let one = progress(coverage: 0.05, steps: [.walkAround: 1])
        XCTAssertTrue(one.canHandIn)
        XCTAssertFalse(one.planComplete)
        XCTAssertFalse(progress(coverage: 0, steps: [:]).canHandIn)
    }

    /// Before a few photographs there is no gap worth pointing at, so the
    /// step just says what to do. After that, the one sentence is spent on
    /// which way round is still thin.
    func testTheWalkingHintWaitsForAFewPhotographs() {
        XCTAssertEqual(progress(coverage: 0.1, steps: [.walkAround: 2], bearing: 60).instruction,
                       ShotStep.walkAround.hintZH)
        XCTAssertEqual(progress(coverage: 0.3, steps: [.walkAround: 5], bearing: 60).instruction,
                       "往你右边走，那边还没拍")
        XCTAssertEqual(progress(coverage: 0.3, steps: [.walkAround: 5], bearing: -60).instruction,
                       "往你左边走，那边还没拍")
    }

    /// ⚠️ The app cannot tell a bonnet from a boot — it knows only which way
    /// the camera pointed — so it must never claim to. This is the assertion
    /// that stops somebody reintroducing "还差车尾" because it reads better.
    func testItNeverNamesAnEndOfTheCar() {
        for bearing in stride(from: -180.0, through: 180.0, by: 7.5) {
            let said = progress(coverage: 0.3, steps: [.walkAround: 5], bearing: bearing).instruction
            XCTAssertFalse(said.contains("车头"), said)
            XCTAssertFalse(said.contains("车尾"), said)
        }
        for step in ShotStep.allCases {
            XCTAssertFalse(step.hintZH.contains("车头"), step.hintZH)
            XCTAssertFalse(step.hintZH.contains("车尾"), step.hintZH)
        }
    }

    /// The roof is four photographs the photographer declares by taking them
    /// while the roof is on screen — not an angle a model has to agree was
    /// reached.
    func testTheRoofIsFourPhotographs() {
        XCTAssertEqual(ShotStep.roof.required, 4)
        XCTAssertEqual(ShotStep.roof.region, .roof)
        XCTAssertFalse(progress(steps: wholePlan(except: .roof)).planComplete)
    }

    /// ⚠️ Filed by step, because there is no camera pose to file by. Most of
    /// the outside is honestly "outside, somewhere"; the two steps that know
    /// better say so.
    func testPhotographsAreFiledByTheirStep() {
        XCTAssertEqual(ShotStep.walkAround.region, .exterior)
        XCTAssertEqual(ShotStep.wheels.region, .exterior)
        XCTAssertEqual(ShotStep.windscreen.region, .front)
        XCTAssertEqual(ShotStep.roof.region, .roof)
        XCTAssertEqual(ShotStep.dashboard.region, .interior)
        XCTAssertTrue(ShotStep.wheels.creditsTheRing)
        XCTAssertFalse(ShotStep.dashboard.creditsTheRing)
    }

    /// The plan has to clear the promise the fleet made: thirty exterior,
    /// eight interior, dashboard among them.
    func testThePlanClearsTheFleetFloors() {
        XCTAssertGreaterThanOrEqual(ShotStep.exteriorRequired, ShootingProgress.exteriorFloor)
        XCTAssertGreaterThanOrEqual(ShotStep.interiorRequired, ShootingProgress.interiorFloor)
        XCTAssertTrue(ShotStep.dashboard.isInterior)
        XCTAssertEqual(ShotStep.walkAround.required, 20)
        XCTAssertEqual(ShotStep.wheels.required, 4)
        XCTAssertEqual(ShotStep.bumperCorners.required, 4)
    }

    /// More photographs make a claim more likely to succeed, so nothing may
    /// tell the photographer they are done — only that the plan is.
    func testPastThePlanItAsksForMoreRatherThanDeclaringVictory() {
        let done = progress(coverage: 0.97, steps: wholePlan())
        XCTAssertTrue(done.planComplete)
        XCTAssertTrue(done.instruction.contains("多拍"), done.instruction)
        XCTAssertFalse(done.instruction.contains("完成"))
    }

    /// There is no ceiling anywhere.
    func testThereIsNoUpperBound() {
        var over = wholePlan()
        for step in ShotStep.allCases { over[step] = step.required * 3 }
        let many = progress(coverage: 1.0, steps: over)
        XCTAssertTrue(many.planComplete)
        XCTAssertTrue(many.outstanding.isEmpty)
        XCTAssertEqual(many.totalShots, ShotStep.totalRequired * 3)
    }

    // MARK: - How wide a photograph actually is

    /// The numbers an iPhone really reports, turned into the angle the
    /// projection needs. Pinned because nothing on screen would look wrong
    /// if they drifted -- the diagram would simply fill in faster.
    func testAPortraitPhotographIsNarrowerThanTheLensSpecSays() {
        // Main camera: ~68 deg across the sensor's long edge, 4:3.
        let wide = CoverageProjection.portraitFieldOfView(alongLongEdge: 68, edges: 4032, 3024)
        XCTAssertEqual(wide, 53.7, accuracy: 0.2)

        // Ultra-wide: ~120 deg, same shape.
        let ultra = CoverageProjection.portraitFieldOfView(alongLongEdge: 120, edges: 4032, 3024)
        XCTAssertEqual(ultra, 104.8, accuracy: 0.2)

        // Both are narrower than the figure AVFoundation hands over, and the
        // gap is what would otherwise be credited to panels nobody shot.
        XCTAssertLessThan(wide, 68)
        XCTAssertLessThan(ultra, 120)
    }

    /// The edges are a ratio, not a measurement, and the caller should not
    /// have to remember which one comes first.
    func testTheEdgesMayArriveInEitherOrderAndAnyUnit() {
        let asGiven = CoverageProjection.portraitFieldOfView(alongLongEdge: 68, edges: 4032, 3024)
        let reversed = CoverageProjection.portraitFieldOfView(alongLongEdge: 68, edges: 3024, 4032)
        let inMillimetres = CoverageProjection.portraitFieldOfView(alongLongEdge: 68, edges: 4, 3)
        XCTAssertEqual(asGiven, reversed, accuracy: 0.0001)
        XCTAssertEqual(asGiven, inMillimetres, accuracy: 0.0001)
    }

    /// A square sensor sees the same angle whichever way up it is held, and
    /// nonsense in comes straight back out rather than becoming a plausible
    /// wrong answer.
    func testDegenerateInputsAreHandedBackUntouched() {
        XCTAssertEqual(CoverageProjection.portraitFieldOfView(alongLongEdge: 68, edges: 1, 1), 68, accuracy: 0.0001)
        XCTAssertEqual(CoverageProjection.portraitFieldOfView(alongLongEdge: 68, edges: 0, 3024), 68)
        XCTAssertEqual(CoverageProjection.portraitFieldOfView(alongLongEdge: 0, edges: 4032, 3024), 0)
    }

    /// The whole reason the conversion exists: at 24 sectors the raw figure
    /// paints a sector of car that was never photographed.
    func testTheUncorrectedFigureOverPaintsByAWholeSector() {
        let sectorWidth = 360.0 / Double(SurfaceCoverage.sectorCount)
        let ultraError = 120 - CoverageProjection.portraitFieldOfView(alongLongEdge: 120, edges: 4032, 3024)
        XCTAssertGreaterThan(ultraError, sectorWidth)
    }
}

/// The coverage basis, after it stopped projecting a guessed surface.
///
/// These are the properties the change was made for. The old projection
/// passed its tests too — and then fitted a shelving unit as part of a car
/// and scored a thorough walk-around at 42%, because every term in it had to
/// be right at once. What is asserted here is mostly the opposite: that
/// getting things wrong stops mattering.
final class BearingCoverageTests: XCTestCase {

    private func car(length: Float = 4.6, width: Float = 1.86, height: Float = 1.68) -> VehicleFrame {
        VehicleFrame(centre: .zero, forward: SIMD3(1, 0, 0), length: length, width: width, height: height)
    }

    /// Stand at a bearing, aim at the car, take a photograph.
    private func shot(
        at degrees: Double, distance: Float = 2.6, height: Float = 1.5, of frame: VehicleFrame
    ) -> Set<CoveragePatch> {
        let angle = degrees * .pi / 180
        let position = frame.centre + SIMD3(
            Float(cos(angle)) * distance, height, Float(sin(angle)) * distance
        )
        let aim = frame.centre + SIMD3(0, frame.height / 2, 0) - position
        return CoverageProjection.patches(
            seenFrom: position, looking: aim, horizontalFieldOfViewDegrees: 54, of: frame
        )
    }

    func testOnePhotographDocumentsTheArcYouAreStandingIn() {
        let frame = car()
        let patches = shot(at: 0, of: frame)
        XCTAssertFalse(patches.isEmpty)

        let sectors = Set(patches.map(\.sector))
        // Straight off the nose: sector 0 and its neighbours, not the tail.
        XCTAssertTrue(sectors.contains(0))
        XCTAssertFalse(sectors.contains(SurfaceCoverage.sectorCount / 2), "credited the far side")
    }

    func testPointingAwayFromTheCarDocumentsNothing() {
        let frame = car()
        let position = SIMD3<Float>(4, 1.5, 0)
        let away = SIMD3<Float>(1, 0, 0)
        XCTAssertTrue(CoverageProjection.patches(
            seenFrom: position, looking: away, horizontalFieldOfViewDegrees: 54, of: frame
        ).isEmpty, "a photograph of the wall behind the car counted")
    }

    func testStandingTooFarAwayDocumentsNothing() {
        XCTAssertTrue(shot(at: 0, distance: 12, of: car()).isEmpty)
    }

    /// ⚠️ The whole reason for the change. The old projection put patches on
    /// a fitted box, so a box 30% too long and 30% too wide moved every one
    /// of them and the score collapsed — measured at 41% against a correct
    /// walk-around's 75%. This basis only uses the centre, so the same bad
    /// box barely registers.
    func testABadlyFittedBoxNoLongerRuinsTheAnswer() {
        func walk(_ frame: VehicleFrame) -> Set<Int> {
            var seen = Set<Int>()
            for step in 0..<24 {
                seen.formUnion(shot(at: Double(step) * 15, of: frame).map(\.sector))
            }
            return seen
        }
        let right = walk(car())
        let swollen = walk(car(length: 6.0, width: 2.4, height: 2.0))
        XCTAssertEqual(right.count, SurfaceCoverage.sectorCount)
        XCTAssertEqual(swollen.count, SurfaceCoverage.sectorCount, "a wrong box still breaks the score")
    }

    func testAWalkAroundCoversEverySideSectorAndNoRoof() {
        var coverage = SurfaceCoverage()
        let frame = car()
        for step in 0..<16 { coverage.add(shot(at: Double(step) * 22.5, of: frame)) }
        XCTAssertEqual(coverage.fraction, 1.0, accuracy: 0.001)
        XCTAssertEqual(coverage.roofFraction, 0, "the roof cannot be had from eye level")
    }

    // MARK: - The roof

    func testTheRoofNeedsThePhoneAboveTheRealRoof() {
        let suv = car(height: 1.68)
        // Reaching up, but not over it.
        let short = CoverageProjection.patches(
            seenFrom: SIMD3(0, 1.60, 1.2), looking: SIMD3(0, -1, -1),
            horizontalFieldOfViewDegrees: 54, of: suv
        )
        XCTAssertFalse(short.contains { $0.band == .roof })

        let over = CoverageProjection.patches(
            seenFrom: SIMD3(0, 2.0, 1.2), looking: SIMD3(0, -1, -1),
            horizontalFieldOfViewDegrees: 54, of: suv
        )
        XCTAssertTrue(over.contains { $0.band == .roof })
    }

    /// ⚠️ Measured height, not a constant. A 1.45m saloon roof is reachable
    /// from the ground and a 1.68m SUV roof is not, and an app that demands
    /// the impossible is one people learn to ignore.
    func testWhetherTheRoofIsAskedForDependsOnHowTallTheCarIs() {
        XCTAssertTrue(car(height: 1.45).roofIsReachable)
        XCTAssertFalse(car(height: 1.68).roofIsReachable)
    }
}
