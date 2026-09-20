import Foundation
import simd

/// Finds the car in a cloud of points.
///
/// This is what a LiDAR phone buys, and it is worth being precise about what
/// that is: **not accuracy, calibration**. Pose tracking is just as good
/// without LiDAR. What the depth sensor removes is the step where somebody
/// has to tell the app where the car is and which way it faces before they can
/// start — they walk up and start shooting instead.
public enum VehicleFrameFitter {

    /// Points below this above the ground are the ground; above it, the
    /// ceiling of a car park or the roof of the van in the next bay.
    static let bodyHeightRange: ClosedRange<Float> = 0.25...2.2

    /// Fits an oriented footprint to a point cloud.
    ///
    /// ⚠️ **Principal component analysis finds the car's axis, not which end
    /// is the nose.** A line has no direction, and a rough mesh of a car is
    /// far too symmetrical to tell a bonnet from a boot. `observedFrom`
    /// resolves it: the walk starts at the front left corner, so whichever end
    /// is nearer the photographer at calibration time is the front. That is
    /// the real reason the shot list starts where it does — reorder it and
    /// this silently starts pointing people at the wrong end of the car.
    ///
    /// Returns nil when the result is not a plausible car, which usually means
    /// the cloud caught a wall or the neighbouring vehicle. The caller falls
    /// back to marking the car by hand rather than guiding against a wall.
    public static func fit(
        points: [SIMD3<Float>],
        groundY: Float,
        observedFrom observer: SIMD3<Float>
    ) -> VehicleFrame? {
        let body = points.filter { bodyHeightRange.contains($0.y - groundY) }
        guard body.count >= 32 else { return nil }

        let footprint = body.map { SIMD2<Float>($0.x, $0.z) }
        let mean = footprint.reduce(SIMD2<Float>.zero, +) / Float(footprint.count)
        guard let axis = principalAxis(of: footprint, mean: mean) else { return nil }

        let perpendicular = SIMD2<Float>(-axis.y, axis.x)
        let along = footprint.map { simd_dot($0 - mean, axis) }
        let across = footprint.map { simd_dot($0 - mean, perpendicular) }

        guard let minAlong = along.min(), let maxAlong = along.max(),
              let minAcross = across.min(), let maxAcross = across.max() else { return nil }

        // The extents are rarely centred on the mean — more of a car's surface
        // faces the photographer than faces away — so the box centre comes
        // from the extents.
        let centre2D = mean
            + axis * ((minAlong + maxAlong) / 2)
            + perpendicular * ((minAcross + maxAcross) / 2)
        let centre = SIMD3<Float>(centre2D.x, groundY, centre2D.y)

        var forward = SIMD3<Float>(axis.x, 0, axis.y)
        // See the warning above: PCA gave a line, the photographer gives it a
        // direction.
        if simd_dot(observer - centre, forward) < 0 { forward = -forward }

        let frame = VehicleFrame(
            centre: centre,
            forward: forward,
            length: maxAlong - minAlong,
            width: maxAcross - minAcross
        )
        return frame.isPlausible ? frame : nil
    }

    /// The direction the points are most spread along: the larger eigenvector
    /// of their 2x2 covariance, solved in closed form.
    static func principalAxis(of points: [SIMD2<Float>], mean: SIMD2<Float>) -> SIMD2<Float>? {
        var xx: Float = 0, xy: Float = 0, yy: Float = 0
        for point in points {
            let d = point - mean
            xx += d.x * d.x
            xy += d.x * d.y
            yy += d.y * d.y
        }
        let count = Float(points.count)
        xx /= count; xy /= count; yy /= count

        // Perfectly isotropic: no axis to find, and a car is never this.
        let discriminant = ((xx - yy) * (xx - yy) + 4 * xy * xy).squareRoot()
        guard discriminant > 1e-6 else { return nil }

        let eigenvalue = (xx + yy + discriminant) / 2
        let candidate = abs(xy) > 1e-6
            ? SIMD2<Float>(eigenvalue - yy, xy)
            : (xx >= yy ? SIMD2<Float>(1, 0) : SIMD2<Float>(0, 1))
        return simd_normalize(candidate)
    }
}
