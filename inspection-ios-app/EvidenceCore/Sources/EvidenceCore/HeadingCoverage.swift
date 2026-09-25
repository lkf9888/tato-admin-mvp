import Foundation

/// Which directions the camera has faced while photographing the outside of
/// the car.
///
/// The rough answer to "did they go round it". Walking round a car and
/// photographing it swings the camera through a full circle, so the circle is
/// cut into sectors and each photograph fills the ones it was facing. A
/// session that went round fills the ring; a session that stood at one door
/// fills a slice of it.
///
/// ⚠️ It replaced a model that mapped every photograph onto the car's actual
/// surface with ARKit and LiDAR. That model was more precise and it cost too
/// much: it held the camera, so the iPhone's own photo pipeline and the 0.5×
/// lens were unavailable; it needed a Pro phone; and when it was wrong — a
/// fitted box that swallowed the shelving beside the car, a roof it
/// considered unreachable — it was wrong insistently, and the person holding
/// the phone could not argue with it. This one cannot be wrong about the car,
/// because it makes no claim about the car. It says which way you have
/// pointed the camera, and that is all it says.
///
/// **It guides, it does not gate.** Nothing here decides whether a
/// photograph counts or whether a session may be handed in.
public struct HeadingCoverage: Sendable, Codable, Equatable {

    /// Fifteen degrees each. Fine enough that one photograph from one side
    /// does not light a quarter of the ring, coarse enough that a sensor that
    /// drifts a few degrees over a walk-around does not matter.
    public static let sectorCount = 24
    public static var sectorWidth: Double { 360 / Double(sectorCount) }

    /// Photographs credited to each sector, indexed from the reference
    /// frame's x axis, counter-clockwise.
    public private(set) var hits: [Int]

    public init() {
        hits = Array(repeating: 0, count: Self.sectorCount)
    }

    /// How far either side of where the camera points one photograph is
    /// credited.
    ///
    /// Half the lens's field of view, held between 15° and 45°: the 0.5× lens
    /// genuinely takes in more of the car than the 1× from the same spot,
    /// and that should show, but no single frame should paint a quarter of
    /// the ring on its own.
    public static func spread(forFieldOfView degrees: Double) -> Double {
        min(max(degrees / 2, 15), 45)
    }

    /// The middle of a sector, in degrees.
    public static func centre(ofSector sector: Int) -> Double {
        (Double(sector) + 0.5) * sectorWidth
    }

    public mutating func record(heading: Double, spreadDegrees: Double) {
        for sector in 0..<Self.sectorCount {
            let distance = abs(CameraHeading.difference(from: heading, to: Self.centre(ofSector: sector)))
            // The sector the camera is actually in always counts, however
            // narrow the spread.
            if distance <= spreadDegrees || distance <= Self.sectorWidth / 2 {
                hits[sector] += 1
            }
        }
    }

    public func isCovered(sector: Int) -> Bool { hits[sector] > 0 }

    public var sectorsCovered: Int { hits.filter { $0 > 0 }.count }

    public var fraction: Double { Double(sectorsCovered) / Double(Self.sectorCount) }

    public var isEmpty: Bool { sectorsCovered == 0 }

    /// Signed degrees from `heading` to the middle of the widest stretch of
    /// ring not yet faced. **Positive means walk to your right.**
    ///
    /// Why right is positive: standing on the south side facing the car —
    /// north, 90° — and walking to your right takes you to the east side,
    /// from where you face west, 180°. Walking right turns the camera
    /// counter-clockwise, and counter-clockwise is the positive direction.
    ///
    /// Nil before the first photograph, when there is nothing to measure a
    /// gap against, and once the ring is full.
    public func gapBearing(from heading: Double) -> Double? {
        guard !isEmpty, sectorsCovered < Self.sectorCount else { return nil }

        // The widest run of empty sectors, walking the ring once from just
        // after a covered one so that a run crossing zero stays in one piece.
        guard let firstCovered = hits.firstIndex(where: { $0 > 0 }) else { return nil }
        var best: (start: Int, length: Int)?
        var runStart: Int?
        var runLength = 0
        for step in 1...Self.sectorCount {
            let sector = (firstCovered + step) % Self.sectorCount
            if hits[sector] == 0 {
                if runStart == nil { runStart = sector }
                runLength += 1
            } else if let start = runStart {
                let candidate = (start, runLength)
                if let current = best {
                    if candidate.1 > current.length
                        || (candidate.1 == current.length
                            && abs(Self.bearing(of: candidate, from: heading))
                                < abs(Self.bearing(of: current, from: heading))) {
                        best = candidate
                    }
                } else {
                    best = candidate
                }
                runStart = nil
                runLength = 0
            }
        }
        guard let best else { return nil }
        return Self.bearing(of: best, from: heading)
    }

    private static func bearing(of run: (start: Int, length: Int), from heading: Double) -> Double {
        let middle = (Double(run.start) + Double(run.length) / 2) * sectorWidth
        return CameraHeading.difference(from: heading, to: middle)
    }
}
