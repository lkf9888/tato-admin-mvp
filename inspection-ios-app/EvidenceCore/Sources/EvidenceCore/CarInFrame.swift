import Foundation
import simd

/// Whether the car is actually in the photograph.
///
/// ⚠️ Nothing used to ask this. A session was thirty-one photographs and a
/// percentage, and one of those photographs — caught in a screenshot — was
/// of a garage floor and a shelf. It counted towards the exterior floor
/// exactly like a photograph of a door. Counting pictures of the ground as
/// evidence of a car's condition is the plainest possible way for this app
/// to be wrong, and it took a screenshot to notice.
///
/// The measurement is the car's own scanned points, projected into the frame
/// the photograph was taken with. Not the fitted box — the points. A box can
/// be the wrong size; the points are where the depth sensor actually found
/// something.
public enum CarInFrame {

    /// How much of the frame the car has to fill to count as photographed.
    ///
    /// Low on purpose. A photograph of one wheel arch from close up is a
    /// legitimate evidence photograph and fills a fair bit of frame; a
    /// photograph taken while walking, of the floor, fills none. This only
    /// has to tell those apart, and anything stricter starts rejecting real
    /// work — which is far more expensive than letting a stray frame
    /// through.
    public static let minimumShare = 0.06

    public struct Reading: Sendable, Equatable {
        /// Fraction of the scanned car points that fall inside the frame.
        public var visible: Double
        /// Fraction of the frame's area their bounding box covers.
        public var share: Double

        public var showsTheCar: Bool { share >= CarInFrame.minimumShare }
    }

    /// Projects the car's points into the camera and measures what lands.
    ///
    /// `points` are world-space samples of the vehicle, `forward` where the
    /// camera pointed. A portrait frame is taller than it is wide, which is
    /// why the two half-angles differ.
    public static func read(
        points: [SIMD3<Float>],
        from position: SIMD3<Float>,
        looking direction: SIMD3<Float>,
        horizontalFieldOfViewDegrees: Double
    ) -> Reading {
        guard !points.isEmpty else { return Reading(visible: 0, share: 0) }

        let view = simd_normalize(direction)
        let flatRight = simd_cross(view, SIMD3<Float>(0, 1, 0))
        let right = simd_length(flatRight) > 1e-4 ? simd_normalize(flatRight) : SIMD3<Float>(1, 0, 0)
        let up = simd_normalize(simd_cross(right, view))

        let halfWidth = tan(horizontalFieldOfViewDegrees / 2 * .pi / 180)
        let halfHeight = tan(
            CoverageProjection.verticalFieldOfView(fromHorizontal: horizontalFieldOfViewDegrees)
                / 2 * .pi / 180
        )

        var inside = 0
        var minX = Double.greatestFiniteMagnitude, maxX = -Double.greatestFiniteMagnitude
        var minY = Double.greatestFiniteMagnitude, maxY = -Double.greatestFiniteMagnitude

        for point in points {
            let offset = point - position
            let ahead = Double(simd_dot(view, offset))
            guard ahead > 0.05 else { continue }
            // Normalised screen coordinates, ±1 at the edges of the frame.
            let x = Double(simd_dot(right, offset)) / ahead / halfWidth
            let y = Double(simd_dot(up, offset)) / ahead / halfHeight
            guard abs(x) <= 1, abs(y) <= 1 else { continue }
            inside += 1
            minX = min(minX, x); maxX = max(maxX, x)
            minY = min(minY, y); maxY = max(maxY, y)
        }

        guard inside > 0 else { return Reading(visible: 0, share: 0) }
        // The frame spans 2 by 2 in these coordinates, so its area is 4.
        let share = ((maxX - minX) * (maxY - minY)) / 4
        return Reading(visible: Double(inside) / Double(points.count), share: min(share, 1))
    }
}
