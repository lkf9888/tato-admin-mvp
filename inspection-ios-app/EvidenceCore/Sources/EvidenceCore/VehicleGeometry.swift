import Foundation
import simd

/// The car, as a shape standing on the ground.
///
/// Everything downstream needs the same three facts: where the car is, which
/// way it points, and how big it is. How the shape gets established differs by
/// device — measured off the depth mesh, or marked by hand — but once it
/// exists the arithmetic is identical, which is why it lives here and not in
/// the ARKit layer.
///
/// World axes are ARKit's: Y is up, because world tracking is gravity-aligned.
public struct VehicleFrame: Sendable, Equatable {
    /// Centre of the car's footprint, at ground level.
    public var centre: SIMD3<Float>
    /// Unit vector along the car's length, pointing out of the bonnet.
    public var forward: SIMD3<Float>
    public var length: Float
    public var width: Float
    /// Roof height above the ground.
    ///
    /// ⚠️ Measured, not assumed. Every band used to sit at a fixed height —
    /// the roof at 1.45m — whatever vehicle was in front of the phone. On a
    /// RAV4, whose roof is at 1.68m, that put the roof patches 23cm inside
    /// the car and scored a surface that was not there. Anything that needs
    /// to know how tall the car is now asks.
    public var height: Float

    public init(
        centre: SIMD3<Float>,
        forward: SIMD3<Float>,
        length: Float,
        width: Float,
        height: Float = 1.5
    ) {
        self.centre = centre
        self.forward = simd_normalize(SIMD3(forward.x, 0, forward.z))
        self.length = length
        self.width = width
        self.height = height
    }

    /// Whether somebody standing on the ground can photograph the roof at
    /// all.
    ///
    /// Held up at arm's length a phone reaches about 1.95m. A roof needs
    /// roughly a third of a metre of clearance below that before the frame
    /// takes in anything but a sliver — measured: a 1.45m roof scores 75%
    /// from 1.8m, a 1.68m roof scores 25%. Above that the requirement is not
    /// difficult, it is impossible, and an app that asks for it anyway is
    /// one people learn to ignore.
    public var roofIsReachable: Bool { height <= 1.58 }

    /// Generously inside the fitted box — used to pick the car's own points
    /// out of the scan, where a little slack costs nothing and a tight test
    /// would drop the wing mirrors and the bumpers.
    public func roughlyContains(_ point: SIMD3<Float>) -> Bool {
        let offset = point - centre
        return abs(Double(simd_dot(offset, forward))) < Double(length) / 2 * 1.15
            && abs(Double(simd_dot(offset, right))) < Double(width) / 2 * 1.2
            && (-0.1...Double(height) + 0.2).contains(Double(point.y - centre.y))
    }

    /// The car's right-hand side — the passenger side in North America.
    ///
    /// Worth checking rather than trusting: with the nose pointing east and Y
    /// up, this comes out as +Z, which on a bird's-eye view is the bottom of
    /// the picture. A car pointing right on a map does have its right flank at
    /// the bottom, so the sign is correct.
    public var right: SIMD3<Float> {
        simd_normalize(simd_cross(forward, SIMD3<Float>(0, 1, 0)))
    }

    /// A plausible car, rather than a wall or the van parked next to it.
    ///
    /// Used to throw out a bad automatic fit. Generous on purpose: it only has
    /// to catch fits that are obviously not a car, because the cost of a false
    /// reject is one more second of scanning and the cost of a false accept is
    /// a whole walk-around measured against a wall.
    public var isPlausible: Bool {
        (3.0...6.5).contains(length)
            && (1.4...2.4).contains(width)
            && (1.1...2.3).contains(height)
            && length > width
    }

    /// Where the camera sits on the ring around the car, as the same
    /// parameter the sectors are numbered by.
    ///
    /// ⚠️ Not a compass bearing. The sectors walk an ellipse, so the angle
    /// that indexes them is the ellipse's parameter — on a car half as wide
    /// as it is long the two differ by up to 20°, which is more than a
    /// sector.
    public func sectorParameter(of position: SIMD3<Float>) -> Double {
        let offset = position - centre
        let along = Double(simd_dot(offset, forward)) / max(Double(length) / 2, 0.01)
        let across = Double(simd_dot(offset, right)) / max(Double(width) / 2, 0.01)
        return atan2(across, along)
    }

    /// A point out in front of the named part of the car, at eye height.
    ///
    /// Used to point somebody at the region they have not covered yet. Not a
    /// station to stand on — nobody is told to go to a mark — just a direction
    /// for an arrow.
    public func lookAt(_ region: CarRegion) -> SIMD3<Float> {
        guard region != .interior else { return centre + SIMD3<Float>(0, 1.0, 0) }
        if region == .roof { return centre + SIMD3<Float>(0, 2.2, 0) }

        let sectors = SurfaceCoverage.sectors(in: region).sorted()
        let middle = sectors[sectors.count / 2]
        let angle = Double(middle) / Double(SurfaceCoverage.sectorCount) * 2 * .pi
        let (point, normal) = CoverageProjection.surfacePoint(sector: angle, band: .body, of: self)
        return point + normal * 1.6
    }
}

/// Degrees on a circle, where 359 and 1 are two apart.
public enum Angle {
    public static func normalised(_ degrees: Double) -> Double {
        let wrapped = degrees.truncatingRemainder(dividingBy: 360)
        return wrapped < 0 ? wrapped + 360 : wrapped
    }

    /// Shortest signed turn from `from` to `to`, in `-180...180`.
    public static func difference(from: Double, to: Double) -> Double {
        let raw = normalised(to) - normalised(from)
        if raw > 180 { return raw - 360 }
        if raw < -180 { return raw + 360 }
        return raw
    }

    public static func distance(_ lhs: Double, _ rhs: Double) -> Double {
        abs(difference(from: lhs, to: rhs))
    }
}

/// Which way to point somebody, relative to where they are already looking.
///
/// Directions around the car are the right frame for the arithmetic and the
/// wrong one for a person: standing in front of the bonnet facing the car,
/// moving "clockwise around the car" is a step to your *left*. Nobody should
/// have to work that out while holding a phone.
public enum Bearing {

    /// Signed degrees from the direction the camera faces to a world point,
    /// in `-180...180`. Positive is to the viewer's right.
    ///
    /// Flattened to the ground plane: whether the target is above or below eye
    /// level is a separate instruction, and mixing the two produces an arrow
    /// that points into the tarmac.
    public static func relative(
        to target: SIMD3<Float>,
        from position: SIMD3<Float>,
        facing forward: SIMD3<Float>
    ) -> Double? {
        let toTarget = SIMD3<Float>(target.x - position.x, 0, target.z - position.z)
        let facing = SIMD3<Float>(forward.x, 0, forward.z)
        guard simd_length(toTarget) > 0.05, simd_length(facing) > 0.001 else { return nil }

        let heading = simd_normalize(facing)
        let right = simd_normalize(simd_cross(heading, SIMD3<Float>(0, 1, 0)))
        let direction = simd_normalize(toTarget)

        let degrees = atan2(Double(simd_dot(direction, right)), Double(simd_dot(direction, heading)))
            * 180 / .pi
        return Angle.difference(from: 0, to: degrees)
    }
}
