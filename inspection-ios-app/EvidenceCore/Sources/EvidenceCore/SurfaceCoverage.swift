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
    public var height: Double {
        switch self {
        case .sill: return 0.35
        case .body: return 0.95
        case .glass: return 1.35
        case .roof: return 1.45
        }
    }

    /// How much of the car's full footprint this band spans, as a fraction.
    ///
    /// A car is not a drum. It is widest at the waist, tucks in at the sills
    /// and narrows sharply into the glasshouse — and that shape is not
    /// decoration, it decides where the surface points sit and therefore
    /// which photographs are credited. One profile serves both the scoring
    /// and the model on screen, so what a photographer sees painted is
    /// literally what was measured.
    public var widthProfile: Double {
        switch self {
        case .sill: return 0.94
        case .body: return 1.00
        case .glass: return 0.82
        case .roof: return 0.64
        }
    }

    /// And how much of its length, which is a different number.
    ///
    /// ⚠️ This is what makes the shape a car rather than a loaf, and it is
    /// not only cosmetic. With one profile for both, the glass band ran the
    /// full length of the vehicle — so the patch for "glass, straight off the
    /// nose" sat 1.35m up in the air above the bonnet, where there is no
    /// glass and nothing to photograph. A cabin that stops short of both ends
    /// puts those patches on the windscreen and the backlight, where they
    /// belong.
    public var lengthProfile: Double {
        switch self {
        case .sill: return 0.98
        case .body: return 1.00
        case .glass: return 0.72
        case .roof: return 0.52
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
    /// Outside the car, position unknown.
    ///
    /// ⚠️ Added when ARKit left the app. Every other exterior region was
    /// worked out from where the camera stood relative to a fitted car, and
    /// with no fitted car the truthful answer for a walk-around photograph is
    /// this one. The server's list of regions has to carry it too, or every
    /// upload is refused -- see `CAR_REGIONS` in lib/inspection.ts.
    case exterior

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
        case .exterior: return "车外"
        }
    }
}

public struct SurfaceCoverage: Sendable, Codable, Equatable {
    /// 24 sectors is 15° apart — fine enough that a missed door reads as a
    /// red stripe rather than a rounding error, coarse enough that one
    /// photograph makes visible progress.
    public static let sectorCount = 24

    /// How many photographs documented each patch.
    ///
    /// ⚠️ A count rather than a flag, and not for the arithmetic — `fraction`
    /// only asks whether it is above zero. It is for the person: a panel seen
    /// from one angle is weaker evidence than the same panel seen from two,
    /// and the model on screen shows that as amber rather than green. Without
    /// it there is no honest middle colour to draw.
    public private(set) var counts: [CoveragePatch: Int]

    /// Two sightings is where a panel stops being a glimpse.
    public static let confidentHits = 2

    public init(counts: [CoveragePatch: Int] = [:]) {
        self.counts = counts
    }

    public init(covered: Set<CoveragePatch>) {
        counts = Dictionary(uniqueKeysWithValues: covered.map { ($0, 1) })
    }

    public var covered: Set<CoveragePatch> {
        Set(counts.filter { $0.value > 0 }.keys)
    }

    /// ⚠️ The roof is **not** in here.
    ///
    /// It used to be, as 24 of 96 patches — a quarter of the score that can
    /// only be reached by holding the phone about 2.2m up, directly over the
    /// middle of the car. Measured: a perfect walk-around at ground level
    /// scored exactly 75% and could never score more, against a finish line
    /// of 90%. A percentage nobody can complete is not a target, it is a
    /// trap. The roof is its own requirement now — see `ShootingProgress`.
    public static var total: Int { sectorCount * (SurfaceBand.allCases.count - 1) }

    public var fraction: Double {
        let sides = counts.filter { $0.key.band != .roof && $0.value > 0 }.count
        return Double(sides) / Double(Self.total)
    }

    /// How well the roof is done, on its own scale.
    public var roofFraction: Double {
        let hit = counts.filter { $0.key.band == .roof && $0.value > 0 }.count
        return Double(hit) / Double(Self.sectorCount)
    }

    /// 0 for never seen, 1 for seen enough. What the colours are drawn from.
    public func confidence(of patch: CoveragePatch) -> Double {
        min(Double(counts[patch] ?? 0), Double(Self.confidentHits)) / Double(Self.confidentHits)
    }

    public mutating func add(_ patches: Set<CoveragePatch>) {
        for patch in patches { counts[patch, default: 0] += 1 }
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

    /// How thoroughly one sector is done, across its three side bands.
    /// What the diagram colours each wedge by.
    public func confidence(ofSector sector: Int) -> Double {
        let bands: [SurfaceBand] = [.sill, .body, .glass]
        let total = bands.reduce(0.0) { $0 + confidence(of: CoveragePatch(sector: sector, band: $1)) }
        return total / Double(bands.count)
    }

    /// The region with the least coverage — where to send somebody next.
    public func thinnestRegion() -> CarRegion? {
        CarRegion.allCases
            .filter { $0 != .interior && $0 != .roof && $0 != .exterior }
            .map { ($0, fraction(of: $0)) }
            .filter { $0.1 < 1 }
            .min { $0.1 < $1.1 }?
            .0
    }

    static func sectors(in region: CarRegion) -> Set<Int> {
        guard region != .interior, region != .exterior else { return [] }
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

    /// The angle a photograph spans **across the screen**, given the lens's
    /// field of view along the sensor's long edge.
    ///
    /// AVFoundation reports `videoFieldOfView` along a format's long edge,
    /// and this app is locked to portrait, so that edge runs top to bottom.
    /// Handing that figure straight to `patches(seenFrom:...)` as a
    /// horizontal angle claims each photograph swept a wider arc of the car
    /// than it did — roughly 13° too much on an iPhone's main camera and 15°
    /// on its ultra-wide, which at 24 sectors is a whole sector per shot.
    ///
    /// The error only ever runs one way: it paints the diagram green over
    /// panels nobody has photographed, which is the failure this app exists
    /// to prevent. Under-claiming merely asks for another photograph, and
    /// more photographs is what a claim wants anyway.
    ///
    /// Degrees in, degrees out. The edges may be given in pixels, points or
    /// millimetres — only their ratio is used — and are accepted in either
    /// order.
    public static func portraitFieldOfView(
        alongLongEdge degrees: Double,
        edges first: Double,
        _ second: Double
    ) -> Double {
        let shortEdge = min(first, second)
        let longEdge = max(first, second)
        guard degrees > 0, degrees < 180, shortEdge > 0, longEdge > 0 else { return degrees }

        let halfTangent = tan(degrees / 2 * .pi / 180) * shortEdge / longEdge
        return atan(halfTangent) * 2 * 180 / .pi
    }

    /// A portrait 4:3 frame is taller than it is wide.
    public static func verticalFieldOfView(fromHorizontal degrees: Double) -> Double {
        atan(tan(degrees / 2 * .pi / 180) * 4 / 3) * 2 * 180 / .pi
    }

    /// How far either side of where somebody stands counts as photographed.
    ///
    /// Stand off the left rear corner with the car filling the frame and you
    /// have documented that corner and a good part of the flank and the tail
    /// with it. Thirty degrees each way is about what one photograph of a
    /// whole car covers, and it is the only inference left in here.
    public static let spreadDegrees = 30.0

    /// The car has to be roughly in front of the camera, not off to one side.
    /// Generous, because a photographer framing a corner does not centre the
    /// whole vehicle.
    public static let aimToleranceDegrees = 55.0

    /// Useful range from the car's centre. Closer and a panel fills the frame
    /// with no context; further and the car is a smudge.
    public static let usableRange: ClosedRange<Double> = 0.8...8.0

    /// Which parts of the car one photograph documents.
    ///
    /// ## Why this no longer projects a surface
    ///
    /// It used to place 96 patches on a fitted ellipse — three bands of
    /// twenty-four plus a roof — and ask of each whether it was inside the
    /// frustum and facing the lens within 65°. Every term in that chain had
    /// to be right at once: the box's length and width from a point cloud,
    /// band heights that were **fixed constants** regardless of the vehicle,
    /// an obliquity limit, a frustum. In the field the chain broke
    /// repeatedly and invisibly — shelving fitted as part of the car and a
    /// thirty-one photograph walk-around scored 42%; an SUV's real roof sat
    /// 23cm above the height the maths scored; and a photographer could not
    /// see which term had gone wrong, only that the app said no.
    ///
    /// What the phone actually knows well is **where it was standing**.
    /// So that is all this asks now: the bearing around the car, whether the
    /// car was in front of the lens, and whether the range was sensible. No
    /// box dimensions, no band heights, no obliquity. A wrong-sized box
    /// barely moves the answer, because the answer only depends on the
    /// centre.
    ///
    /// What is given up is the claim "you missed the left rear sill". What is
    /// bought is an answer that is right.
    public static func patches(
        seenFrom position: SIMD3<Float>,
        looking direction: SIMD3<Float>,
        horizontalFieldOfViewDegrees: Double,
        of frame: VehicleFrame,
        sectorCount: Int = SurfaceCoverage.sectorCount
    ) -> Set<CoveragePatch> {
        let view = simd_normalize(direction)
        let toCentre = frame.centre + SIMD3<Float>(0, frame.height / 2, 0) - position
        let range = Double(simd_length(toCentre))
        guard usableRange.contains(range) else { return [] }
        // Pointed at the car, rather than past it.
        guard Double(simd_dot(view, toCentre / Float(range))) >= cos(aimToleranceDegrees * .pi / 180)
        else { return [] }

        let middle = frame.sectorParameter(of: position) / (2 * .pi) * Double(sectorCount)
        let reach = spreadDegrees / 360 * Double(sectorCount)

        // Above the roof and looking down is the only way to document it.
        let overhead = Double(position.y) > Double(frame.height) + 0.18 && Double(view.y) < -0.25

        var seen = Set<CoveragePatch>()
        var offset = -reach
        while offset <= reach {
            let index = Int((middle + offset).rounded())
            let sector = ((index % sectorCount) + sectorCount) % sectorCount
            for band in [SurfaceBand.sill, .body, .glass] {
                seen.insert(CoveragePatch(sector: sector, band: band))
            }
            if overhead { seen.insert(CoveragePatch(sector: sector, band: .roof)) }
            offset += 1
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
        let semiLength = Double(frame.length) / 2 * band.lengthProfile
        let semiWidth = Double(frame.width) / 2 * band.widthProfile
        let along = cos(angle)
        let across = sin(angle)

        if band == .roof {
            // The roof is a flat cap, inset so its patches sit over the car
            // rather than out at the sills. Its normal points up, which is
            // why no amount of walking around at eye level covers it.
            let point = frame.centre
                + frame.forward * Float(along * semiLength)
                + frame.right * Float(across * semiWidth)
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
