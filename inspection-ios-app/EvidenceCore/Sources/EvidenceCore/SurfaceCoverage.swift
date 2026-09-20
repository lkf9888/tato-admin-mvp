import Foundation
import simd

/// The car's outer surface, divided into patches that get painted in as they
/// are photographed.
///
/// This replaces the shot list. A named list of stations teaches the
/// photographer the app's internal model — where to stand, what each position
/// is called, in what order — before they can take a single useful picture.
/// Painting teaches nothing: the parts you have not covered are the parts
/// that are still red, and you walk over and shoot them.
///
/// **Coverage is measured against this fitted shape, never against a LiDAR
/// mesh.** Dark paint and glass are specular: infrared does not come back off
/// them, so they simply never appear in a reconstructed mesh. Scoring
/// completeness off the mesh would leave a black car permanently unfinished,
/// with the photographer circling it forever — worse than the checklist it
/// replaced. The shape exists whether or not the sensor sees it.
public enum SurfaceBand: String, Sendable, Codable, CaseIterable {
    /// Rocker panels, lower bumpers, wheels — the damage nobody photographs.
    case sill
    /// Doors and panels at waist height.
    case body
    /// Windows and the shoulder line.
    case glass
    /// The top face. Its normal points up, so it cannot be covered from eye
    /// level — which is what makes the overhead shot necessary without
    /// anybody having to name it.
    case roof

    /// Height above the ground of this band's surface, in metres.
    var height: Double {
        switch self {
        case .sill: return 0.35
        case .body: return 0.95
        case .glass: return 1.40
        case .roof: return 1.45
        }
    }
}

public struct CoveragePatch: Sendable, Codable, Hashable {
    /// Index around the car, counting from straight ahead of the bonnet.
    public let sector: Int
    public let band: SurfaceBand

    public init(sector: Int, band: SurfaceBand) {
        self.sector = sector
        self.band = band
    }
}

/// A coarse direction, derived from where a photograph was taken rather than
/// dictated to the photographer beforehand.
///
/// Exists so the review page can still put the handover and the return of the
/// same corner side by side. The label is an output of shooting, not a
/// constraint on it.
public enum CarRegion: String, Sendable, Codable, CaseIterable {
    case front, frontRight, right, rearRight, rear, rearLeft, left, frontLeft, roof, interior

    public var titleZH: String {
        switch self {
        case .front: return "车头"
        case .frontRight: return "右前"
        case .right: return "右侧"
        case .rearRight: return "右后"
        case .rear: return "车尾"
        case .rearLeft: return "左后"
        case .left: return "左侧"
        case .frontLeft: return "左前"
        case .roof: return "车顶"
        case .interior: return "车内"
        }
    }
}

public struct SurfaceCoverage: Sendable, Codable, Equatable {
    /// 24 sectors is 15° apart — fine enough that a missed door reads as a
    /// red stripe rather than a rounding error, coarse enough that one
    /// photograph makes visible progress.
    public static let sectorCount = 24

    public private(set) var covered: Set<CoveragePatch>

    public init(covered: Set<CoveragePatch> = []) {
        self.covered = covered
    }

    public static var total: Int { sectorCount * SurfaceBand.allCases.count }

    public var fraction: Double { Double(covered.count) / Double(Self.total) }

    public mutating func add(_ patches: Set<CoveragePatch>) {
        covered.formUnion(patches)
    }

    /// Patches still unphotographed, for drawing the red areas.
    public func missing() -> Set<CoveragePatch> {
        var all = Set<CoveragePatch>()
        for sector in 0..<Self.sectorCount {
            for band in SurfaceBand.allCases {
                all.insert(CoveragePatch(sector: sector, band: band))
            }
        }
        return all.subtracting(covered)
    }

    /// Coverage per region, for telling somebody which way to walk.
    public func fraction(of region: CarRegion) -> Double {
        let sectors = Self.sectors(in: region)
        guard !sectors.isEmpty else { return 0 }
        let bands: [SurfaceBand] = region == .roof ? [.roof] : [.sill, .body, .glass]
        let wanted = sectors.count * bands.count
        let hit = covered.filter { sectors.contains($0.sector) && bands.contains($0.band) }.count
        return Double(hit) / Double(wanted)
    }

    /// The region with the least coverage — where to send somebody next.
    public func thinnestRegion() -> CarRegion? {
        CarRegion.allCases
            .filter { $0 != .interior }
            .map { ($0, fraction(of: $0)) }
            .filter { $0.1 < 1 }
            .min { $0.1 < $1.1 }?
            .0
    }

    static func sectors(in region: CarRegion) -> Set<Int> {
        guard region != .interior else { return [] }
        if region == .roof { return Set(0..<sectorCount) }
        // Eight regions of three sectors each, centred on the compass points.
        let index = CarRegion.allCases.firstIndex(of: region) ?? 0
        let centre = index * (sectorCount / 8)
        return Set((-1...1).map { (centre + $0 + sectorCount) % sectorCount })
    }

    public static func region(ofSector sector: Int, band: SurfaceBand) -> CarRegion {
        if band == .roof { return .roof }
        let perRegion = sectorCount / 8
        let index = ((sector + perRegion / 2) % sectorCount) / perRegion
        return CarRegion.allCases[min(index, 7)]
    }
}

/// Works out which of the car's patches a photograph actually documents.
public enum CoverageProjection {

    /// A patch seen at a grazing angle shows no damage, so it does not count.
    ///
    /// 65° off the surface normal, which compresses a panel to about 40% of
    /// its width — a dent is still plainly visible. Tighter sounds safer and
    /// is not: the bands are modelled with horizontal normals, so a
    /// photographer standing at eye level in front of a car is already 55-60°
    /// off the normal of its front bumper. At 55° the bumper never counted as
    /// photographed no matter how carefully it was shot.
    static let maximumObliquityDegrees = 65.0

    /// Outside this range a panel is either too close to be in focus or too
    /// far to show a scratch.
    static let usableDistance: ClosedRange<Double> = 0.25...7.0

    /// The patches documented by one photograph.
    public static func patches(
        seenFrom position: SIMD3<Float>,
        looking direction: SIMD3<Float>,
        horizontalFieldOfViewDegrees: Double,
        of frame: VehicleFrame,
        sectorCount: Int = SurfaceCoverage.sectorCount
    ) -> Set<CoveragePatch> {
        let view = simd_normalize(direction)
        let halfField = cos(horizontalFieldOfViewDegrees / 2 * .pi / 180)
        let minimumFacing = cos(maximumObliquityDegrees * .pi / 180)

        var seen = Set<CoveragePatch>()
        for sector in 0..<sectorCount {
            let angle = Double(sector) / Double(sectorCount) * 2 * .pi
            for band in SurfaceBand.allCases {
                let (point, normal) = surfacePoint(sector: angle, band: band, of: frame)
                let toCamera = position - point
                let distance = Double(simd_length(toCamera))
                guard usableDistance.contains(distance) else { continue }

                let towards = toCamera / Float(distance)
                // Facing the camera, not the back of the car.
                guard Double(simd_dot(normal, towards)) >= minimumFacing else { continue }
                // Inside the frame.
                guard Double(simd_dot(view, -towards)) >= halfField else { continue }

                seen.insert(CoveragePatch(sector: sector, band: band))
            }
        }
        return seen
    }

    /// A point on the car's skin, and the direction that skin faces.
    ///
    /// The cross-section is an ellipse rather than the box used for distances:
    /// a box would give four flat faces and four sharp corners, and every
    /// patch on a face would share one normal — so a single photograph taken
    /// square to a door would "cover" the entire side of the car.
    static func surfacePoint(
        sector angle: Double,
        band: SurfaceBand,
        of frame: VehicleFrame
    ) -> (point: SIMD3<Float>, normal: SIMD3<Float>) {
        let semiLength = Double(frame.length) / 2
        let semiWidth = Double(frame.width) / 2
        let along = cos(angle)
        let across = sin(angle)

        if band == .roof {
            // The roof is a flat cap, inset so its patches sit over the car
            // rather than out at the sills. Its normal points up, which is
            // why no amount of walking around at eye level covers it.
            let point = frame.centre
                + frame.forward * Float(along * semiLength * 0.6)
                + frame.right * Float(across * semiWidth * 0.6)
                + SIMD3<Float>(0, Float(band.height), 0)
            return (point, SIMD3<Float>(0, 1, 0))
        }

        let point = frame.centre
            + frame.forward * Float(along * semiLength)
            + frame.right * Float(across * semiWidth)
            + SIMD3<Float>(0, Float(band.height), 0)

        // Gradient of the ellipse: the outward normal at this angle.
        let normal = simd_normalize(
            frame.forward * Float(along / semiLength) + frame.right * Float(across / semiWidth)
        )
        return (point, normal)
    }
}

public extension VehicleFrame {
    /// Whether the camera is inside the car.
    ///
    /// This is how interior photographs are counted without asking anybody to
    /// declare what they are shooting: the geometry already knows where the
    /// phone is. A little inside the footprint and below roof height is a
    /// person sitting in a seat with their arm out.
    func contains(_ position: SIMD3<Float>) -> Bool {
        let offset = position - centre
        let along = abs(Double(simd_dot(offset, forward)))
        let across = abs(Double(simd_dot(offset, right)))
        let up = Double(position.y - centre.y)
        return along < Double(length) / 2 * 0.9
            && across < Double(width) / 2 * 0.9
            && (0.3...1.5).contains(up)
    }
}
