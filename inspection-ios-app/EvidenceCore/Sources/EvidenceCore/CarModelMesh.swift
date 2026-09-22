import Foundation
import simd

/// A compact SUV, lofted along its own profile, painted with the coverage.
///
/// Shaped on a RAV4 because that is what the fleet and most of Turo is, and
/// because the previous model — rings of constant height — had no bonnet, no
/// windscreen rake and no tailgate. It came out a loaf, and a photographer
/// who cannot tell which end they are looking at cannot use it to find the
/// panel they missed.
///
/// ## The skin and the measurement
///
/// ⚠️ This shape is **not** the shape the coverage is scored against. That is
/// still the ring model in `CoverageProjection` — four bands on an ellipse,
/// verified, and not something to perturb for the sake of a picture. What is
/// guaranteed instead is the *reading*: every vertex takes the confidence of
/// the patch it actually sits on, found by bearing and by height, so a green
/// door means the arithmetic credited that door. `sectorAndBand` is where
/// that mapping lives and it has tests, because a model that drifts from the
/// numbers stops being a reading and becomes a reassurance — which is the
/// failure that let a walk-around sit at 42% while the diagram looked busy.
public struct CarModelMesh: Sendable {

    /// Positions in metres, car centred on the origin, nose along +X, ground
    /// at y = 0.
    public let positions: [SIMD3<Float>]
    public let normals: [SIMD3<Float>]
    /// 0 never photographed, 1 photographed enough. The renderer interpolates
    /// between vertices, which is where the gradient comes from.
    public let confidence: [Float]
    /// ⚠️ False where nothing measures this surface, and it is drawn grey.
    ///
    /// The bonnet and the boot lid are horizontal panels outside the cabin,
    /// and the ring model has no band for them: its four bands are three
    /// vertical rings and a roof. Painting them with the reading of the
    /// nearest patch would put a colour on a panel nobody checked, which is
    /// the difference between a reading and a reassurance. Grey says the
    /// true thing — and says it loudly enough that the gap gets closed
    /// rather than forgotten.
    public let measured: [Bool]
    public let indices: [Int32]
    /// Where the wheels go, so the view can stand something recognisable in
    /// each arch. Four centres and a radius.
    public let wheelCentres: [SIMD3<Float>]
    public let wheelRadius: Float

    /// The side view, as a table.
    ///
    /// `t` runs +1 at the front bumper to -1 at the rear. `halfWidth` is a
    /// fraction of the car's half width, `roof` a fraction of its height.
    /// Read down the column and the RAV4 is there: a blunt nose, a long flat
    /// bonnet, a windscreen that stands up rather than lies back, a roof
    /// that stays level for most of the cabin, and a tailgate that drops
    /// almost vertically.
    static let stations: [(t: Double, halfWidth: Double, roof: Double)] = [
        (1.00, 0.82, 0.30),
        (0.96, 0.89, 0.40),
        (0.90, 0.94, 0.46),
        (0.80, 0.98, 0.49),
        (0.66, 1.00, 0.51),
        (0.50, 1.00, 0.52),
        (0.38, 1.00, 0.53),
        (0.30, 0.99, 0.62),
        (0.22, 0.97, 0.74),
        (0.13, 0.95, 0.86),
        (0.04, 0.94, 0.93),
        (-0.10, 0.94, 0.955),
        (-0.30, 0.94, 0.96),
        (-0.48, 0.94, 0.955),
        (-0.60, 0.93, 0.94),
        (-0.70, 0.93, 0.86),
        (-0.78, 0.95, 0.75),
        (-0.85, 0.97, 0.64),
        (-0.91, 0.97, 0.55),
        (-0.96, 0.93, 0.44),
        (-1.00, 0.85, 0.31),
    ]

    /// How square the cross-section is. An estate car is nearly an ellipse;
    /// an SUV has flat flanks and a flat roof with the corners rounded off,
    /// which is what this exponent buys.
    static let sectionSquareness = 3.2
    /// Underside of the body, above which everything is painted. Below it is
    /// air and wheels.
    static let skirt = 0.20
    /// Points around each cross-section. Enough that the corners read as
    /// corners rather than facets.
    static let ringPoints = 40

    public init(coverage: SurfaceCoverage, length: Double = 4.6, width: Double = 1.86, height: Double = 1.68) {
        var positions: [SIMD3<Float>] = []
        var normals: [SIMD3<Float>] = []
        var confidence: [Float] = []
        var measured: [Bool] = []
        var indices: [Int32] = []

        let semiLength = length / 2
        let semiWidth = width / 2
        let ring = Self.ringPoints

        for station in Self.stations {
            let x = station.t * semiLength
            let halfWidth = station.halfWidth * semiWidth
            let top = station.roof * height
            let centreY = (Self.skirt + top) / 2
            let halfHeight = max((top - Self.skirt) / 2, 0.02)

            for step in 0...ring {
                // Around the cross-section: 0 is the outside of the right
                // flank, going up over the roof and down the left.
                let theta = Double(step) / Double(ring) * 2 * .pi
                let (offsetZ, offsetY, sectionNormal) = Self.superellipse(
                    theta, halfWidth: halfWidth, halfHeight: halfHeight, power: Self.sectionSquareness
                )
                let point = SIMD3<Float>(Float(x), Float(centreY + offsetY), Float(offsetZ))
                positions.append(point)

                // The lengthwise slope matters: without it the bonnet and the
                // tailgate light as if they were vertical.
                let slope = Self.slope(atT: station.t, semiLength: semiLength, height: height)
                let normal = simd_normalize(SIMD3<Float>(
                    Float(slope * (offsetY > 0 ? 1 : 0)),
                    Float(sectionNormal.y),
                    Float(sectionNormal.z)
                ))
                normals.append(normal)

                let reading = Self.reading(
                    of: point, normal: normal, semiLength: semiLength, semiWidth: semiWidth
                )
                measured.append(reading != nil)
                confidence.append(reading.map {
                    Float(coverage.confidence(of: CoveragePatch(sector: $0.sector, band: $0.band)))
                } ?? 0)
            }
        }

        let columns = ring + 1
        for row in 0..<(Self.stations.count - 1) {
            for column in 0..<ring {
                let a = Int32(row * columns + column)
                let b = a + 1
                let c = a + Int32(columns)
                let d = c + 1
                indices.append(contentsOf: [a, b, c, b, d, c])
            }
        }

        self.positions = positions
        self.normals = normals
        self.confidence = confidence
        self.measured = measured
        self.indices = indices
        // A RAV4's wheelbase is 2.69m of its 4.6m, and its tyres stand about
        // 0.35m tall. Not scored — landmarks, so the eye knows at a glance
        // which end it is looking at.
        let axle = Float(semiLength * (2.69 / 4.6))
        let track = Float(semiWidth * 0.92)
        wheelRadius = Float(height * (0.352 / 1.68))
        wheelCentres = [
            SIMD3(axle, wheelRadius, track), SIMD3(axle, wheelRadius, -track),
            SIMD3(-axle, wheelRadius, track), SIMD3(-axle, wheelRadius, -track),
        ]
    }

    public var triangleCount: Int { indices.count / 3 }

    // MARK: - Shape

    /// A superellipse and its outward normal, in the cross-section plane.
    static func superellipse(
        _ theta: Double, halfWidth: Double, halfHeight: Double, power: Double
    ) -> (z: Double, y: Double, normal: SIMD3<Double>) {
        let c = cos(theta), s = sin(theta)
        let exponent = 2 / power
        let z = halfWidth * (c < 0 ? -1 : 1) * pow(abs(c), exponent)
        let y = halfHeight * (s < 0 ? -1 : 1) * pow(abs(s), exponent)

        // Gradient of |z/a|^p + |y/b|^p.
        let gz = (z < 0 ? -1.0 : 1.0) * pow(abs(z) / halfWidth, power - 1) / halfWidth
        let gy = (y < 0 ? -1.0 : 1.0) * pow(abs(y) / halfHeight, power - 1) / halfHeight
        let n = simd_normalize(SIMD3<Double>(0, gy, gz))
        return (z, y, n)
    }

    /// How steeply the roofline rises or falls here, as a lengthwise tilt for
    /// the normal. Positive means the surface faces forwards.
    static func slope(atT t: Double, semiLength: Double, height: Double) -> Double {
        guard let index = stations.firstIndex(where: { $0.t <= t }) else { return 0 }
        let low = max(index - 1, 0)
        let high = min(index, stations.count - 1)
        guard low != high else { return 0 }
        let run = (stations[low].t - stations[high].t) * semiLength
        let rise = (stations[low].roof - stations[high].roof) * height
        guard abs(run) > 1e-6 else { return 0 }
        return -rise / run
    }

    // MARK: - The reading

    /// Which measured patch a point on the skin belongs to.
    ///
    /// Bearing gives the sector, using the same ellipse parameter the
    /// projection does rather than a plain compass angle — otherwise the
    /// long axis and the short axis would not line up and the nose would be
    /// painted with the flank's reading. Height gives the band, except where
    /// the surface faces the sky, which is the roof whatever height it is at.
    /// Nil where no band covers this surface — see `measured`.
    public static func reading(
        of point: SIMD3<Float>,
        normal: SIMD3<Float>,
        semiLength: Double,
        semiWidth: Double
    ) -> (sector: Int, band: SurfaceBand)? {
        let angle = atan2(Double(point.z) / semiWidth, Double(point.x) / semiLength)
        let turns = angle / (2 * .pi)
        let count = SurfaceCoverage.sectorCount
        let sector = ((Int((turns * Double(count)).rounded()) % count) + count) % count

        // ⚠️ Facing the sky is not enough to be the roof. A bonnet is very
        // nearly horizontal too, and classifying it as roof painted the
        // entire front of the car with the roof's reading — so a car whose
        // nose had been photographed twice still showed a red bonnet. It has
        // to be facing up **and** be up there: above the waist.
        // ⚠️ Slope, not just height, tells these three apart.
        //
        // A bonnet is nearly flat; a windscreen is raked; a roof is flat and
        // high. Sorting by height alone put the lower half of the windscreen
        // in with the bonnet and greyed it out, and sorting by "faces the
        // sky" alone painted the whole bonnet with the roof's reading.
        let flat = Double(normal.y) > 0.85
        let high = Double(point.y) > SurfaceBand.glass.height - 0.12
        if flat {
            // Flat and high is the roof. Flat and low is a bonnet or a boot
            // lid, which no band covers.
            return high ? (sector, .roof) : nil
        }
        if Double(normal.y) > 0.55, high { return (sector, .roof) }

        let y = Double(point.y)
        let bands: [SurfaceBand] = [.sill, .body, .glass]
        let band = bands.min { abs($0.height - y) < abs($1.height - y) } ?? .body
        return (sector, band)
    }
}
