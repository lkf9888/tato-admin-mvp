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
    /// How wide a cone in front of the camera counts as "what they are
    /// pointing at". Generous: the photographer is holding the car in frame,
    /// not aiming a rifle.
    static let viewConeDegrees = 55.0

    /// Ground-plane cell for the connected-components pass. About a third of
    /// a car's width — small enough that a car and the shelving beside it
    /// fall apart, large enough that the gaps in a sparse mesh do not split
    /// one car into three.
    static let clusterCell: Float = 0.32

    /// A car's roof sits in here. A shelf unit or a stack of boxes usually
    /// does not, and a wall runs straight past it.
    static let roofHeightRange: ClosedRange<Float> = 1.05...2.05

    public static func fit(
        points: [SIMD3<Float>],
        groundY: Float,
        observedFrom observer: SIMD3<Float>,
        looking heading: SIMD3<Float>? = nil
    ) -> VehicleFrame? {
        let body = points.filter { bodyHeightRange.contains($0.y - groundY) }
        guard body.count >= 32 else { return nil }
        let candidates = cluster(body, observedFrom: observer, looking: heading, groundY: groundY)
        guard candidates.count >= 32 else { return nil }
        return fitCluster(candidates, groundY: groundY, observedFrom: observer)
    }

    /// Picks the blob the photographer is pointing at.
    ///
    /// ⚠️ **This is the difference between fitting a car and fitting a room.**
    /// Principal component analysis has no notion of "the interesting object"
    /// — handed a garage it finds the axis of the garage. A real session did
    /// exactly that: the mesh within eight metres included the shelving unit
    /// alongside the car, PCA returned a 6.0 by 2.4 metre box, that box
    /// passed the plausibility check, and the photographer circled the actual
    /// car for thirty-one photographs while the score sat at 42%. Simulating
    /// that box against a correct walk-around reproduces 41%.
    ///
    /// Two signals separate them, and neither needs the person to do
    /// anything. They are pointing the camera at the car — that is what they
    /// opened the app to do. And a car is a lump that stands apart from the
    /// things around it, so connected components on the ground plane cuts it
    /// out of the scenery.
    static func cluster(
        _ points: [SIMD3<Float>],
        observedFrom observer: SIMD3<Float>,
        looking heading: SIMD3<Float>?,
        groundY: Float
    ) -> [SIMD3<Float>] {
        var looked = points
        if let heading {
            let flat = SIMD2<Float>(heading.x, heading.z)
            if simd_length(flat) > 1e-4 {
                let aim = simd_normalize(flat)
                let limit = Float(cos(viewConeDegrees * .pi / 180))
                looked = points.filter { point in
                    let away = SIMD2<Float>(point.x - observer.x, point.z - observer.z)
                    let range = simd_length(away)
                    guard range > 0.3, range < 7 else { return false }
                    return simd_dot(away / range, aim) >= limit
                }
            }
        }
        guard !looked.isEmpty else { return [] }

        // Connected components over occupied ground cells.
        var cells: [SIMD2<Int32>: [Int]] = [:]
        for (index, point) in looked.enumerated() {
            let key = SIMD2<Int32>(Int32(floor(point.x / clusterCell)), Int32(floor(point.z / clusterCell)))
            cells[key, default: []].append(index)
        }

        var unvisited = Set(cells.keys)
        var best: [SIMD3<Float>] = []
        var bestScore = -Float.greatestFiniteMagnitude

        while let seed = unvisited.first {
            var queue = [seed]
            unvisited.remove(seed)
            var members: [Int] = []
            while let key = queue.popLast() {
                members.append(contentsOf: cells[key] ?? [])
                for dx in Int32(-1)...1 {
                    for dz in Int32(-1)...1 {
                        let neighbour = SIMD2<Int32>(key.x + dx, key.y + dz)
                        if unvisited.remove(neighbour) != nil { queue.append(neighbour) }
                    }
                }
            }
            let blob = members.map { looked[$0] }
            guard blob.count >= 32 else { continue }
            let score = carLikeness(of: blob, groundY: groundY, observedFrom: observer)
            if score > bestScore {
                bestScore = score
                best = blob
            }
        }
        return best
    }

    /// Ranks a blob by how much it behaves like the car somebody is standing
    /// next to. Nearness wins ties, because the photographer is beside the
    /// car and not beside the wall behind it.
    static func carLikeness(
        of blob: [SIMD3<Float>],
        groundY: Float,
        observedFrom observer: SIMD3<Float>
    ) -> Float {
        let xs = blob.map(\.x), zs = blob.map(\.z), ys = blob.map(\.y)
        guard let minX = xs.min(), let maxX = xs.max(),
              let minZ = zs.min(), let maxZ = zs.max(), let maxY = ys.max()
        else { return -.greatestFiniteMagnitude }

        let span = SIMD2<Float>(maxX - minX, maxZ - minZ)
        let long = max(span.x, span.y), short = min(span.x, span.y)
        var score: Float = 0

        // A footprint of roughly car size and car proportions.
        if (3.0...6.5).contains(long) { score += 3 } else { score -= 2 }
        if (1.3...2.6).contains(short) { score += 2 } else { score -= 2 }
        // Something with a roof at car height, rather than a wall that simply
        // continues upward past where the height filter cut it off.
        if roofHeightRange.contains(maxY - groundY) { score += 3 }

        let centre = SIMD2<Float>((minX + maxX) / 2, (minZ + maxZ) / 2)
        let range = simd_length(centre - SIMD2<Float>(observer.x, observer.z))
        return score - range / 10
    }

    private static func fitCluster(
        _ body: [SIMD3<Float>],
        groundY: Float,
        observedFrom observer: SIMD3<Float>
    ) -> VehicleFrame? {

        let footprint = body.map { SIMD2<Float>($0.x, $0.z) }
        let mean = footprint.reduce(SIMD2<Float>.zero, +) / Float(footprint.count)
        guard let axis = principalAxis(of: footprint, mean: mean) else { return nil }

        let perpendicular = SIMD2<Float>(-axis.y, axis.x)
        let along = footprint.map { simd_dot($0 - mean, axis) }
        let across = footprint.map { simd_dot($0 - mean, perpendicular) }

        // ⚠️ Extents, but only of the thing the photographer is beside.
        //
        // Connected components cannot separate a car from shelving parked
        // 0.35m off its flank — the mesh cells bridge that, and tightening
        // them instead shatters the car, whose own mesh is full of holes
        // where the paint and the glass gave the infrared nothing to come
        // back off. What does separate them is the gap itself: along the
        // across-axis the points stop, and then start again. Grow out from
        // the point nearest the photographer and stop at the first real gap,
        // and what is left is the car they are standing next to.
        let anchor = nearestIndex(in: body, to: observer)
        guard let alongSpan = span(of: along, from: anchor),
              let acrossSpan = span(of: across, from: anchor) else { return nil }
        let (minAlong, maxAlong) = alongSpan
        let (minAcross, maxAcross) = acrossSpan

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

        // The roof, measured off the cluster rather than assumed. The filter
        // above cuts at 2.2m, so a wall reads as exactly that and fails the
        // plausibility check on height alone.
        let roof = (body.map { $0.y - groundY }.max() ?? 1.5)

        let frame = VehicleFrame(
            centre: centre,
            forward: forward,
            length: maxAlong - minAlong,
            width: maxAcross - minAcross,
            height: roof
        )
        return frame.isPlausible ? frame : nil
    }

    /// Where the cloud stops being one object, along one axis.
    ///
    /// Single-linkage from the anchor: walk outwards through the sorted
    /// projections and stop at the first gap wider than a car's own holes.
    static let solidGap: Float = 0.22

    static func span(of values: [Float], from anchor: Int) -> (Float, Float)? {
        guard values.indices.contains(anchor) else { return nil }
        let sorted = values.sorted()
        guard let seat = sorted.firstIndex(where: { $0 >= values[anchor] }) ?? sorted.indices.last
        else { return nil }
        let start = min(seat, sorted.count - 1)

        var low = start
        while low > 0, sorted[low] - sorted[low - 1] <= solidGap { low -= 1 }
        var high = start
        while high < sorted.count - 1, sorted[high + 1] - sorted[high] <= solidGap { high += 1 }
        return (sorted[low], sorted[high])
    }

    static func nearestIndex(in points: [SIMD3<Float>], to observer: SIMD3<Float>) -> Int {
        var best = 0
        var bestDistance = Float.greatestFiniteMagnitude
        for (index, point) in points.enumerated() {
            let d = simd_distance_squared(point, observer)
            if d < bestDistance { bestDistance = d; best = index }
        }
        return best
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
