import XCTest
@testable import EvidenceCore

/// The shutter gate is the one piece of this app that can stop somebody
/// working. Everything here is about the two ways it can be wrong: dark when
/// the hand is steady, or slow to come back once it is.
final class SteadinessGateTests: XCTestCase {

    /// Feeds a constant rate for a while and hands back the clock.
    @discardableResult
    private func feed(
        _ gate: inout SteadinessGate,
        rate: Double,
        seconds: Double,
        from start: TimeInterval,
        hertz: Double = 100
    ) -> TimeInterval {
        let step = 1 / hertz
        var now = start
        let end = start + seconds
        while now < end - step / 2 {
            now += step
            gate.accept(rotationRate: rate, at: now)
        }
        return now
    }

    /// Returns the moment the gate first reported steady again, or nil.
    private func timeToRecover(
        _ gate: inout SteadinessGate,
        rate: Double,
        within seconds: Double,
        from start: TimeInterval,
        hertz: Double = 100
    ) -> TimeInterval? {
        let step = 1 / hertz
        var now = start
        while now < start + seconds {
            now += step
            if gate.accept(rotationRate: rate, at: now) { return now - start }
        }
        return nil
    }

    // MARK: - It must never be the reason nobody can shoot

    /// A phone with no motion sensor, or one whose motion access was
    /// refused, hands this gate nothing at all. Absence of a reading is not
    /// evidence of shake.
    func testAGateThatHasSeenNothingLetsYouShoot() {
        let gate = SteadinessGate()
        XCTAssertTrue(gate.isSteady)
    }

    func testResetLetsYouShootAgain() {
        var gate = SteadinessGate()
        feed(&gate, rate: 1.5, seconds: 0.4, from: 0)
        XCTAssertFalse(gate.isSteady)

        gate.reset()
        XCTAssertTrue(gate.isSteady, "a new walk-around must not inherit the last one's lockout")
    }

    // MARK: - The number the whole feature is answerable to

    /// Shake, stop, and measure. Past about 150ms this reads as lag rather
    /// than as a camera being careful, and somebody who perceives lag takes
    /// fewer photographs.
    func testTheShutterComesBackInsideTheRecoveryBudget() {
        var gate = SteadinessGate()
        let shakenUntil = feed(&gate, rate: 1.2, seconds: 0.5, from: 0)
        XCTAssertFalse(gate.isSteady)

        let recovery = timeToRecover(&gate, rate: 0.02, within: 1.0, from: shakenUntil)
        let elapsed = try? XCTUnwrap(recovery)
        XCTAssertNotNil(elapsed, "the shutter never came back")
        XCTAssertLessThanOrEqual(elapsed ?? .infinity, SteadinessGate.recoveryBudget)
    }

    /// Same promise on a phone whose motion sensor runs slower. The windows
    /// are seconds rather than per-sample weights precisely so that a slow
    /// sensor does not become a slow shutter.
    func testTheBudgetHoldsAtAThirdOfTheSampleRate() {
        var gate = SteadinessGate()
        let shakenUntil = feed(&gate, rate: 1.2, seconds: 0.5, from: 0, hertz: 30)
        XCTAssertFalse(gate.isSteady)

        let recovery = timeToRecover(&gate, rate: 0.02, within: 1.0, from: shakenUntil, hertz: 30)
        XCTAssertNotNil(recovery)
        XCTAssertLessThanOrEqual(recovery ?? .infinity, SteadinessGate.recoveryBudget)
    }

    // MARK: - It must not swallow the shot it is protecting

    /// Pressing the shutter shakes the phone. If the gate reacts to that, it
    /// can disable the button between the finger landing and the tap
    /// registering — and the photograph it was protecting is the one it ate.
    func testTheJoltOfPressingTheShutterDoesNotVetoTheShot() {
        var gate = SteadinessGate()
        feed(&gate, rate: 0.04, seconds: 0.5, from: 0)

        // A finger arriving: brief, and nothing like a swung arm.
        feed(&gate, rate: 0.5, seconds: 0.06, from: 0.5)
        XCTAssertTrue(gate.isSteady, "a tap must not close the gate; smoothed \(gate.smoothedRate)")
    }

    /// A hand that is merely alive, rather than moving. Below `shakeAbove`
    /// nothing should ever close, no matter how long it goes on.
    func testAHandThatIsSimplyNotAStatueNeverClosesTheGate() {
        var gate = SteadinessGate()
        feed(&gate, rate: 0.30, seconds: 5, from: 0)
        XCTAssertTrue(gate.isSteady)
    }

    // MARK: - But it must still close on real shake

    func testWalkingPaceShakeClosesItQuickly() {
        var gate = SteadinessGate()
        feed(&gate, rate: 0.04, seconds: 0.5, from: 0)

        var closedAfter: TimeInterval?
        var now = 0.5
        while now < 1.0 {
            now += 0.01
            if !gate.accept(rotationRate: 1.0, at: now) {
                closedAfter = now - 0.5
                break
            }
        }
        XCTAssertNotNil(closedAfter, "real shake has to close the gate")
        XCTAssertLessThanOrEqual(closedAfter ?? .infinity, 0.10)
    }

    // MARK: - No strobing

    /// A hand oscillating across the threshold must not flicker the button
    /// faster than somebody can aim at it. The guarantee is concrete: no
    /// dark period is ever shorter than `minimumDarkness`.
    func testNoDarkPeriodIsShorterThanTheMinimum() {
        var gate = SteadinessGate()
        var now: TimeInterval = 0
        var wasSteady = true
        var wentDarkAt: TimeInterval = 0
        var shortest = TimeInterval.infinity

        // Four seconds of a hand crossing the boundary back and forth.
        for cycle in 0..<20 {
            let high = cycle.isMultiple(of: 2)
            let step = 1.0 / 100
            for _ in 0..<10 {
                now += step
                let steady = gate.accept(rotationRate: high ? 0.7 : 0.05, at: now)
                if wasSteady, !steady {
                    wentDarkAt = now
                } else if !wasSteady, steady {
                    shortest = min(shortest, now - wentDarkAt)
                }
                wasSteady = steady
            }
        }

        if shortest.isFinite {
            XCTAssertGreaterThanOrEqual(shortest, SteadinessGate.minimumDarkness - 0.011)
        }
    }

    // MARK: - Smoothing

    /// Nothing to smooth against on the first sample, so it is taken at face
    /// value rather than blended with a zero that was never measured.
    func testTheFirstSampleIsTakenAtFaceValue() {
        var gate = SteadinessGate()
        gate.accept(rotationRate: 0.9, at: 10)
        XCTAssertEqual(gate.smoothedRate, 0.9, accuracy: 0.0001)
        XCTAssertFalse(gate.isSteady)
    }

    /// Falling is faster than rising. This is the asymmetry the design rests
    /// on, so it gets an assertion of its own rather than living only in a
    /// comment somebody may later "tidy up".
    func testItLetsGoFasterThanItGrabs() {
        XCTAssertLessThan(SteadinessGate.fallWindow, SteadinessGate.riseWindow)

        var rising = SteadinessGate()
        rising.accept(rotationRate: 0, at: 0)
        rising.accept(rotationRate: 1.0, at: 0.01)
        let afterOneRisingStep = rising.smoothedRate

        var falling = SteadinessGate()
        falling.accept(rotationRate: 1.0, at: 0)
        falling.accept(rotationRate: 0, at: 0.01)
        let travelledWhileFalling = 1.0 - falling.smoothedRate

        XCTAssertGreaterThan(travelledWhileFalling, afterOneRisingStep)
    }

    /// The gap between the two thresholds is what stops the chatter. If
    /// somebody ever closes it, this fails.
    func testThereIsAGapBetweenClosingAndOpening() {
        XCTAssertLessThan(SteadinessGate.calmBelow, SteadinessGate.shakeAbove)
    }
}
