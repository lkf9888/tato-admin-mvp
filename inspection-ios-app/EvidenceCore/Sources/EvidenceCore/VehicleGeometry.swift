import Foundation
import simd

/// The car, as a box standing on the ground.
///
/// Everything the guidance needs is in here: where the car is, which way it
/// points, and how big it is. How the box got established differs by device —
/// measured off the LiDAR mesh, or marked by the photographer — but once it
/// exists the arithmetic downstream is identical, which is why it lives here
/// and not in the ARKit layer.
///
/// World axes are ARKit's: Y is up, because world tracking is gravity-aligned.
public struct VehicleFrame: Sendable, Equatable {
    /// Centre of the car's footprint, at ground level.
    public var centre: SIMD3<Float>
    /// Unit vector along the car's length, pointing out of the bonnet.
    public var forward: SIMD3<Float>
    public var length: Float
    public var width: Float

    public init(centre: SIMD3<Float>, forward: SIMD3<Float>, length: Float, width: Float) {
        self.centre = centre
        self.forward = simd_normalize(SIMD3(forward.x, 0, forward.z))
        self.length = length
        self.width = width
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
    /// to catch fits that are obviously not a car, because the cost of a
    /// false reject is one manual calibration and the cost of a false accept
    /// is a whole walk-around guided against the wrong object.
    public var isPlausible: Bool {
        (3.0...6.5).contains(length) && (1.4...2.4).contains(width) && length > width
    }
}

/// Where the photographer is standing, in the car's own frame of reference.
public struct Placement: Sendable, Equatable {
    /// Degrees clockwise from straight ahead of the bonnet, in `0..<360`.
    public var azimuthDegrees: Double
    /// Metres from the car's footprint — zero if standing over it, not from
    /// the centre. "Two metres from the car" is what a person means.
    public var distance: Double
    /// Camera height above the ground the car is standing on.
    public var height: Double

    public init(azimuthDegrees: Double, distance: Double, height: Double) {
        self.azimuthDegrees = azimuthDegrees
        self.distance = distance
        self.height = height
    }
}

public extension VehicleFrame {

    /// Where a photographer standing on `station` would be.
    ///
    /// The inverse of `placement(ofCameraAt:)`, used to drop a marker on the
    /// spot somebody is being sent to.
    ///
    /// Solved by bisection rather than algebra. The closed form needs a case
    /// split on whether the point is off the end of the car, off its side, or
    /// diagonally off a corner — three branches, each easy to get subtly
    /// wrong, to save a few dozen float operations that run once per frame at
    /// most. Bisection is monotonic here and converges past float precision.
    func worldPosition(for station: Station) -> SIMD3<Float> {
        let radians = Float(station.azimuthDegrees * .pi / 180)
        let direction = forward * cos(radians) + right * sin(radians)
        let target = station.distance.metres

        var low: Float = 0
        var high = length + width + Float(target) * 2
        for _ in 0..<48 {
            let middle = (low + high) / 2
            let probe = centre + direction * middle
            if placement(ofCameraAt: probe).distance < target {
                low = middle
            } else {
                high = middle
            }
        }

        let ground = centre + direction * ((low + high) / 2)
        return SIMD3<Float>(ground.x, centre.y + Float(station.height.metres), ground.z)
    }

    func placement(ofCameraAt position: SIMD3<Float>) -> Placement {
        let offset = position - centre
        let along = Double(simd_dot(offset, forward))
        let across = Double(simd_dot(offset, right))

        // Distance to the footprint rectangle, not to the centre: standing
        // level with the front wheel is 0.6m from the car whether the car is
        // a hatchback or a limousine.
        let overhangAlong = max(0, abs(along) - Double(length) / 2)
        let overhangAcross = max(0, abs(across) - Double(width) / 2)

        return Placement(
            azimuthDegrees: Angle.normalised(atan2(across, along) * 180 / .pi),
            distance: (overhangAlong * overhangAlong + overhangAcross * overhangAcross).squareRoot(),
            height: Double(position.y - centre.y)
        )
    }
}

/// Degrees on a circle, where 359 and 1 are two apart.
public enum Angle {
    public static func normalised(_ degrees: Double) -> Double {
        let wrapped = degrees.truncatingRemainder(dividingBy: 360)
        return wrapped < 0 ? wrapped + 360 : wrapped
    }

    /// Shortest signed turn from `from` to `to`, in `-180...180`.
    /// Positive is the same direction azimuth increases.
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
/// The turn in `CoverageGuidance` is measured around the car, which is the
/// right frame for the arithmetic and the wrong one for a person: standing in
/// front of the bonnet facing the car, moving "clockwise around the car" is a
/// step to your *left*. Nobody should have to work that out while holding a
/// phone. This converts to the frame the photographer is actually in.
public enum Bearing {

    /// Signed degrees from the direction the camera faces to a world point,
    /// in `-180...180`. Positive is to the viewer's right.
    ///
    /// Flattened to the ground plane: whether the target is above or below
    /// eye level is a separate instruction, and mixing the two produces an
    /// arrow that points into the tarmac.
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
