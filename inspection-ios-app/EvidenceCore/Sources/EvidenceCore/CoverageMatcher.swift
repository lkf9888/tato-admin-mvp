import Foundation

/// How far off a station a photographer may stand and still count as being
/// there.
///
/// Wide on purpose. The point is to catch somebody who photographed the same
/// corner four times and called it a walk-around, not to march them onto a
/// mark. Tight tolerances would turn a two-minute job into a fight with the
/// phone, and staff who fight the phone stop using it.
public struct StationTolerance: Sendable, Equatable {
    /// Half of the 45° spacing between the ring stations, so the sectors abut
    /// without overlapping.
    public var azimuthDegrees: Double
    public var distanceMetres: Double
    public var heightMetres: Double

    public init(azimuthDegrees: Double = 22.5, distanceMetres: Double = 1.5, heightMetres: Double = 0.6) {
        self.azimuthDegrees = azimuthDegrees
        self.distanceMetres = distanceMetres
        self.heightMetres = heightMetres
    }

    public static let standard = StationTolerance()
}

/// What to tell the photographer right now.
public struct CoverageGuidance: Sendable, Equatable {
    /// The station being stood in, if any.
    public var currentSlot: ShotSlot?
    /// The nearest shot still outstanding — where to go next.
    public var nextSlot: ShotSlot?
    /// Signed turn towards `nextSlot`, in degrees. Positive is the direction
    /// azimuth increases: towards the car's right side.
    public var turnDegrees: Double?
    /// Signed metres to `nextSlot`'s distance band. Negative means step in.
    public var distanceChange: Double?
    /// Signed metres of height. Negative means crouch.
    public var heightChange: Double?

    public var isOnStation: Bool { currentSlot != nil && currentSlot?.id == nextSlot?.id }
}

/// Turns a position into "which shot is this".
public enum CoverageMatcher {

    /// The station the photographer is standing in, or nil if they are
    /// between stations.
    ///
    /// ⚠️ Azimuth alone cannot do this. `front_three_quarter_right` sits at
    /// 45° and `wheel_front_right` at 60° — fifteen degrees apart, well inside
    /// any usable angular tolerance. What separates them is that one is taken
    /// standing three and a half metres back and the other crouched at arm's
    /// length. All three axes are scored, or the walk-around checks itself off
    /// from the wrong place.
    public static func station(
        for placement: Placement,
        among slots: [ShotSlot],
        tolerance: StationTolerance = .standard
    ) -> ShotSlot? {
        slots
            .compactMap { slot -> (ShotSlot, Double)? in
                guard let error = error(of: placement, against: slot, tolerance: tolerance) else { return nil }
                return (slot, error)
            }
            .min { $0.1 < $1.1 }?
            .0
    }

    /// Normalised squared error across all three axes, or nil when any one of
    /// them is out of tolerance.
    static func error(of placement: Placement, against slot: ShotSlot, tolerance: StationTolerance) -> Double? {
        guard let station = slot.station else { return nil }

        let azimuth = Angle.distance(placement.azimuthDegrees, station.azimuthDegrees) / tolerance.azimuthDegrees
        let distance = abs(placement.distance - station.distance.metres) / tolerance.distanceMetres
        let height = abs(placement.height - station.height.metres) / tolerance.heightMetres

        guard azimuth <= 1, distance <= 1, height <= 1 else { return nil }
        return azimuth * azimuth + distance * distance + height * height
    }

    /// Where to go next, and how to get there.
    ///
    /// Sends the photographer to the nearest outstanding shot by angle rather
    /// than by the plan's order, so a retake later in the walk does not mean
    /// walking the whole ring again.
    public static func guidance(
        for placement: Placement,
        outstanding: [ShotSlot],
        tolerance: StationTolerance = .standard
    ) -> CoverageGuidance {
        let current = station(for: placement, among: outstanding, tolerance: tolerance)

        let next = current ?? outstanding
            .filter { $0.station != nil }
            .min { lhs, rhs in
                let left = Angle.distance(placement.azimuthDegrees, lhs.station!.azimuthDegrees)
                let right = Angle.distance(placement.azimuthDegrees, rhs.station!.azimuthDegrees)
                return left < right
            }

        guard let target = next, let station = target.station else {
            return CoverageGuidance(currentSlot: current, nextSlot: nil)
        }

        return CoverageGuidance(
            currentSlot: current,
            nextSlot: target,
            turnDegrees: Angle.difference(from: placement.azimuthDegrees, to: station.azimuthDegrees),
            distanceChange: station.distance.metres - placement.distance,
            heightChange: station.height.metres - placement.height
        )
    }
}
