import Foundation

/// The photographs a claim needs, in the order they are asked for.
///
/// ⚠️ This is a shot list, and this app deleted a shot list once. The
/// distinction is the whole design. The one that was removed named
/// twenty-four **positions to stand in** — it taught the app's internal model
/// to the person holding the phone, and it was wrong about which end of the
/// car was the front, so it sent people to the boot to photograph the bonnet.
/// This one names **subjects**: eleven things an assessor asks for by name.
/// Where a subject is ambiguous the app says nothing about direction and draws
/// the thing instead (see the outline overlay on the viewfinder), so nobody
/// has to translate an instruction into a place to stand.
///
/// Three of these cannot be inferred from a camera pose at all, which is why
/// the list exists next to the coverage arithmetic rather than instead of it:
/// a kerbed alloy is the most argued item in a car-sharing claim and it is
/// eight pixels of rim in a photograph of the flank; a bumper corner is the
/// panel that gets scraped in every car park in Vancouver and it faces the
/// ground; a roof is out of reach of the geometry on anything taller than a
/// saloon.
public enum ShotStep: String, Sendable, Codable, CaseIterable, Identifiable {
    /// Walk the whole way round. The only step the coverage arithmetic
    /// grades; everything after it is a declared subject.
    case walkAround
    /// The four lower corners of the front and rear bumpers.
    case bumperCorners
    case wheels
    case roof
    case windscreen
    case rearSeats
    case frontSeats
    case centreConsole
    case dashboard
    /// The interior roof, from inside. Cigarette burns and stains live here
    /// and nobody photographs it unless asked.
    case headliner
    /// Carpets and door panels — the two items on Turo's own interior list
    /// that nothing above covers.
    case carpetsAndDoors

    public var id: String { rawValue }

    /// How many photographs this step wants before the app moves on.
    ///
    /// ⚠️ Floors, never targets. Nothing in this app may suggest that enough
    /// photographs have been taken — see `ShootingProgress`. A step that is
    /// full keeps accepting photographs; it just stops being the one on
    /// screen.
    public var required: Int {
        switch self {
        case .walkAround: return 20
        case .bumperCorners: return 4
        case .wheels: return 4
        case .roof: return 4
        case .carpetsAndDoors: return 3
        case .windscreen, .rearSeats, .frontSeats, .centreConsole, .dashboard, .headliner: return 1
        }
    }

    public var titleZH: String {
        switch self {
        case .walkAround: return "环绕一圈"
        case .bumperCorners: return "保险杠四角"
        case .wheels: return "四条轮胎"
        case .roof: return "车顶前后"
        case .windscreen: return "挡风玻璃"
        case .rearSeats: return "后排座椅"
        case .frontSeats: return "前排座椅"
        case .centreConsole: return "中控台"
        case .dashboard: return "仪表盘"
        case .headliner: return "车内顶棚"
        case .carpetsAndDoors: return "地毯和门板"
        }
    }

    /// The one line on screen while this step is current. It says what to
    /// photograph, never where to stand.
    public var hintZH: String {
        switch self {
        case .walkAround: return "绕车一圈，整车都要进框"
        case .bumperCorners: return "前后保险杠下方四个角，一角一张"
        case .wheels: return "四条轮胎各一张，轮毂要拍全"
        case .roof: return "车顶前后各两张，手机举高往下拍"
        case .windscreen: return "正对挡风玻璃拍一张"
        case .rearSeats: return "坐进后排，拍后排座椅"
        case .frontSeats: return "拍前排两个座椅"
        case .centreConsole: return "拍中控台"
        case .dashboard: return "拍仪表盘，里程数要看得清"
        case .headliner: return "抬头拍车内顶棚"
        case .carpetsAndDoors: return "脚垫和门板内侧，补三张"
        }
    }

    /// Shot from inside the car, and counted towards the interior floor
    /// rather than the exterior one.
    ///
    /// ⚠️ Taken from the step rather than from the camera pose. A dashboard
    /// photographed from the driver's seat and a wheel photographed from a
    /// crouch are both inside the fitted footprint, and the geometry cannot
    /// separate them. The person holding the phone can.
    public var isInterior: Bool {
        switch self {
        case .rearSeats, .frontSeats, .centreConsole, .dashboard, .headliner, .carpetsAndDoors:
            return true
        default:
            return false
        }
    }

    /// Where these photographs are filed, when the step knows better than the
    /// camera pose does. Nil means the pose decides — which is what keeps the
    /// coverage arithmetic fed while the exterior steps are running.
    public var region: CarRegion? {
        if isInterior { return .interior }
        // ⚠️ Roof photographs are taken from the ground with the phone held
        // overhead, so the pose puts the camera at chest height beside the
        // car and files them as a flank. The subject is declared; believe it.
        return self == .roof ? .roof : nil
    }

    /// Whether the coverage arithmetic has a say in whether this step is
    /// done.
    ///
    /// Only the walk-around. A count of twenty says somebody pressed the
    /// shutter twenty times; coverage says they went round. Every other step
    /// is a declared subject and the count is the whole of it — which is the
    /// point, because those are exactly the subjects the geometry gets wrong.
    public var isGradedByCoverage: Bool { self == .walkAround }

    /// Whether a photograph in this step has to have the car in it.
    ///
    /// ⚠️ Only the walk-around, and this is a fix rather than an oversight.
    /// The frame check exists to stop a photograph of a garage floor counting
    /// towards the exterior floor, and it works by asking what share of the
    /// screen the scanned car points fill. A wheel close-up fills the frame
    /// with one arch, a dashboard is shot from inside the point cloud, and a
    /// roof is shot from underneath it — the share is meaningless in all
    /// three. Applying it there rejected exactly the photographs somebody had
    /// just been told to take.
    public var needsTheCarInFrame: Bool { self == .walkAround }

    /// For the strip under the viewfinder. The overlay draws the real thing.
    public var symbolName: String {
        switch self {
        case .walkAround: return "arrow.triangle.2.circlepath"
        case .bumperCorners: return "car.side.rear.and.collision.and.car.side.front"
        case .wheels: return "circle.circle"
        case .roof: return "car.top.door.front.left.open"
        case .windscreen: return "car.window.left"
        case .rearSeats: return "carseat.right.rear"
        case .frontSeats: return "carseat.left"
        case .centreConsole: return "steeringwheel"
        case .dashboard: return "gauge.with.dots.needle.bottom.50percent"
        case .headliner: return "car.top.radiowaves.rear.right"
        case .carpetsAndDoors: return "rectangle.portrait.on.rectangle.portrait"
        }
    }

    public static let exterior = allCases.filter { !$0.isInterior }
    public static let interior = allCases.filter(\.isInterior)

    /// What the whole plan comes to, if nobody takes a single extra
    /// photograph.
    public static var totalRequired: Int { allCases.reduce(0) { $0 + $1.required } }
    public static var exteriorRequired: Int { exterior.reduce(0) { $0 + $1.required } }
    public static var interiorRequired: Int { interior.reduce(0) { $0 + $1.required } }
}
