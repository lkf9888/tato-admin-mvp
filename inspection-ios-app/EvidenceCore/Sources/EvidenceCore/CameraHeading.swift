import Foundation
import simd

/// Which way the back camera is pointing, around the vertical axis.
///
/// This is what replaced ARKit as the answer to "did they go round the car".
/// Walking round a car and photographing it turns the camera through a full
/// circle; standing in one place photographing one door does not. The
/// gyroscope can tell those apart without knowing where the car is, without
/// LiDAR, and without holding the camera — which is what makes it possible to
/// photograph with the iPhone's own camera pipeline and both lenses.
///
/// ⚠️ Rough on purpose. It cannot see the car, so it cannot tell a walk round
/// a vehicle from a slow turn on the spot in an empty car park. That is the
/// trade that was chosen: this app guides, it does not police, and an
/// instruction that is occasionally too generous costs nothing, while one
/// that is wrong and insistent costs the user.
public enum CameraHeading {

    /// How close to straight up or down the camera may point and still have a
    /// heading. A phone aimed at the floor is not facing any side of a car,
    /// and the horizontal part of its direction is noise.
    public static let minimumHorizontal = 0.26

    /// Degrees counter-clockwise from the reference frame's x axis, seen from
    /// above, in `0..<360`. Nil when the camera points too nearly straight up
    /// or down to face any direction.
    ///
    /// ⚠️ Convention-proof, on purpose. Core Motion's rotation matrix is
    /// documented as "the attitude" and not as which way it maps — device to
    /// reference frame or the reverse — and the two readings are each other's
    /// transpose. Guess wrong and the heading does not merely flip: with the
    /// phone held upright it stops changing at all as the user turns.
    ///
    /// So nothing is guessed. Gravity is reported in the device's own frame,
    /// and in the reference frame it points straight down, because that frame
    /// has Z vertical by construction. Whichever of the matrix and its
    /// transpose carries the one onto the other is the device-to-reference
    /// map, whatever Apple meant, and the camera direction goes through that.
    ///
    /// - Parameters:
    ///   - rows: the attitude's rotation matrix, row by row as `m11...m33`.
    ///   - gravity: gravity in the device frame, any length.
    public static func degrees(
        rows: (SIMD3<Double>, SIMD3<Double>, SIMD3<Double>),
        gravity: SIMD3<Double>
    ) -> Double? {
        guard simd_length(gravity) > 1e-6 else { return nil }
        let down = simd_normalize(gravity)
        let matrix = simd_double3x3(rows: [rows.0, rows.1, rows.2])
        let candidates = [matrix, matrix.transpose]
        let straightDown = SIMD3<Double>(0, 0, -1)
        guard let toReference = candidates.min(by: {
            simd_distance($0 * down, straightDown) < simd_distance($1 * down, straightDown)
        }) else { return nil }

        // The back camera looks out of the back of the phone: the device's
        // negative Z axis.
        let camera = toReference * SIMD3<Double>(0, 0, -1)
        let horizontal = (camera.x * camera.x + camera.y * camera.y).squareRoot()
        guard horizontal >= minimumHorizontal else { return nil }
        let degrees = atan2(camera.y, camera.x) * 180 / .pi
        return degrees < 0 ? degrees + 360 : degrees
    }

    /// Signed difference `to − from`, wrapped into `-180...180`.
    public static func difference(from: Double, to: Double) -> Double {
        var delta = (to - from).truncatingRemainder(dividingBy: 360)
        if delta > 180 { delta -= 360 }
        if delta <= -180 { delta += 360 }
        return delta
    }
}
