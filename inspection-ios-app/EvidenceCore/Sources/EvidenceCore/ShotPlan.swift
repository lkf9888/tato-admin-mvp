import Foundation

public enum ShotGroup: String, Sendable, Codable, CaseIterable {
    case exterior
    case interior
}

public enum Framing: String, Sendable, Codable {
    /// The whole car has to fit in the frame, corner to corner.
    case wholeVehicle
    /// One panel or one instrument, close enough to see a scratch or a digit.
    case detail
}

public enum HeightBand: String, Sendable, Codable {
    /// Crouched — wheels, sills, the underside of a bumper.
    case low
    case eye
    /// Arms above the head. The screen is not visible from here.
    case overhead

    /// Camera height above the ground the car is standing on.
    ///
    /// One set of numbers for everybody, which is a simplification: a 1.6m
    /// photographer's "eye level" is not a 1.9m one's. The tolerance around
    /// these bands is wide enough to swallow that, and the band only has to
    /// separate a crouch from a stand from a reach.
    public var metres: Double {
        switch self {
        case .low: return 0.5
        case .eye: return 1.5
        case .overhead: return 2.1
        }
    }
}

public enum DistanceBand: String, Sendable, Codable {
    case close   // ≈0.6 m
    case medium  // ≈1.5 m
    case wide    // ≈3.5 m

    public var metres: Double {
        switch self {
        case .close: return 0.6
        case .medium: return 1.5
        case .wide: return 3.5
        }
    }
}

/// Where the photographer stands, in the car's own frame of reference.
///
/// Azimuth is degrees clockwise seen from above, with 0° directly ahead of
/// the bonnet. `CoverageEngine` turns the live device pose into one of these
/// and decides which slot the photographer is currently standing in.
public struct Station: Sendable, Codable, Hashable {
    public var azimuthDegrees: Double
    public var height: HeightBand
    public var distance: DistanceBand

    public init(azimuthDegrees: Double, height: HeightBand, distance: DistanceBand) {
        self.azimuthDegrees = azimuthDegrees
        self.height = height
        self.distance = distance
    }
}

public struct ShotSlot: Sendable, Codable, Hashable, Identifiable {
    public let id: String
    public let group: ShotGroup
    public let titleZH: String
    public let titleEN: String
    /// Spoken aloud when `handsFree` is set, shown on screen otherwise.
    public let guidanceZH: String
    public let guidanceEN: String
    public let framing: Framing
    /// nil for interior slots, which have no meaningful station outside the car.
    public let station: Station?
    /// The roof: taken with the phone above the photographer's head, where no
    /// amount of on-screen guidance is visible. Those slots are driven by
    /// speech and haptics instead.
    public let handsFree: Bool
    /// The odometer and the fuel gauge are worthless unless the numbers can be
    /// read, so they are scored against `ImageQualityThresholds.legibleText`.
    public let requiresLegibleText: Bool

    public var thresholds: ImageQualityThresholds {
        requiresLegibleText ? .legibleText : .provisional
    }
}

/// The shot list a session has to complete before it can be submitted.
///
/// Sized against Turo's published guidance for host trip photos — at least 15
/// exterior and at least 8 interior, with the odometer and the fuel or charge
/// level among them. `ShotPlanTests` holds those floors so nobody trims the
/// list below what a claim needs.
///
/// **No undercarriage slot, by decision.** Turo does not cover undercarriage
/// damage, and a phone cannot photograph a car's underside anyway: it is an
/// occluded, unlit space where the LiDAR has nothing to range against and
/// ARKit loses tracking outright. What is covered instead is the lower
/// bumpers and the area immediately below the tyres, shot from a crouch.
public enum ShotPlan {

    public static let standard: [ShotSlot] = exterior + interior

    public static let exterior: [ShotSlot] = [
        .init(
            id: "front_three_quarter_left", group: .exterior,
            titleZH: "左前 45°", titleEN: "Front three-quarter, left",
            guidanceZH: "站到车头左前方，整车要全部进框", guidanceEN: "Stand off the left front corner, whole car in frame",
            framing: .wholeVehicle,
            station: .init(azimuthDegrees: 315, height: .eye, distance: .wide),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "front", group: .exterior,
            titleZH: "正前", titleEN: "Front",
            guidanceZH: "正对车头，保险杠和两侧大灯都要在框内", guidanceEN: "Square to the bonnet, bumper and both headlights in frame",
            framing: .wholeVehicle,
            station: .init(azimuthDegrees: 0, height: .eye, distance: .wide),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "front_three_quarter_right", group: .exterior,
            titleZH: "右前 45°", titleEN: "Front three-quarter, right",
            guidanceZH: "站到车头右前方，整车要全部进框", guidanceEN: "Stand off the right front corner, whole car in frame",
            framing: .wholeVehicle,
            station: .init(azimuthDegrees: 45, height: .eye, distance: .wide),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "side_right", group: .exterior,
            titleZH: "右侧全身", titleEN: "Right side",
            guidanceZH: "正对右侧，车头到车尾都要在框内", guidanceEN: "Square to the right flank, nose to tail in frame",
            framing: .wholeVehicle,
            station: .init(azimuthDegrees: 90, height: .eye, distance: .wide),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "rear_three_quarter_right", group: .exterior,
            titleZH: "右后 45°", titleEN: "Rear three-quarter, right",
            guidanceZH: "站到车尾右后方，整车要全部进框", guidanceEN: "Stand off the right rear corner, whole car in frame",
            framing: .wholeVehicle,
            station: .init(azimuthDegrees: 135, height: .eye, distance: .wide),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "rear", group: .exterior,
            titleZH: "正后", titleEN: "Rear",
            guidanceZH: "正对车尾，后保险杠和尾灯都要在框内", guidanceEN: "Square to the tail, rear bumper and both lights in frame",
            framing: .wholeVehicle,
            station: .init(azimuthDegrees: 180, height: .eye, distance: .wide),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "rear_three_quarter_left", group: .exterior,
            titleZH: "左后 45°", titleEN: "Rear three-quarter, left",
            guidanceZH: "站到车尾左后方，整车要全部进框", guidanceEN: "Stand off the left rear corner, whole car in frame",
            framing: .wholeVehicle,
            station: .init(azimuthDegrees: 225, height: .eye, distance: .wide),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "side_left", group: .exterior,
            titleZH: "左侧全身", titleEN: "Left side",
            guidanceZH: "正对左侧，车头到车尾都要在框内", guidanceEN: "Square to the left flank, nose to tail in frame",
            framing: .wholeVehicle,
            station: .init(azimuthDegrees: 270, height: .eye, distance: .wide),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "wheel_front_left", group: .exterior,
            titleZH: "左前轮", titleEN: "Front left wheel",
            guidanceZH: "蹲下来拍，轮毂、轮胎侧壁、轮胎下方一并入框", guidanceEN: "Crouch: rim, sidewall and the ground under the tyre",
            framing: .detail,
            station: .init(azimuthDegrees: 300, height: .low, distance: .close),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "wheel_front_right", group: .exterior,
            titleZH: "右前轮", titleEN: "Front right wheel",
            guidanceZH: "蹲下来拍，轮毂、轮胎侧壁、轮胎下方一并入框", guidanceEN: "Crouch: rim, sidewall and the ground under the tyre",
            framing: .detail,
            station: .init(azimuthDegrees: 60, height: .low, distance: .close),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "wheel_rear_right", group: .exterior,
            titleZH: "右后轮", titleEN: "Rear right wheel",
            guidanceZH: "蹲下来拍，轮毂、轮胎侧壁、轮胎下方一并入框", guidanceEN: "Crouch: rim, sidewall and the ground under the tyre",
            framing: .detail,
            station: .init(azimuthDegrees: 120, height: .low, distance: .close),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "wheel_rear_left", group: .exterior,
            titleZH: "左后轮", titleEN: "Rear left wheel",
            guidanceZH: "蹲下来拍，轮毂、轮胎侧壁、轮胎下方一并入框", guidanceEN: "Crouch: rim, sidewall and the ground under the tyre",
            framing: .detail,
            station: .init(azimuthDegrees: 240, height: .low, distance: .close),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "bumper_front_lower", group: .exterior,
            titleZH: "前保险杠下沿", titleEN: "Front bumper, lower edge",
            guidanceZH: "蹲到很低，贴着地面往上拍前保险杠下沿", guidanceEN: "Down low, angled up along the underside of the front bumper",
            framing: .detail,
            station: .init(azimuthDegrees: 0, height: .low, distance: .close),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "bumper_rear_lower", group: .exterior,
            titleZH: "后保险杠下沿", titleEN: "Rear bumper, lower edge",
            guidanceZH: "蹲到很低，贴着地面往上拍后保险杠下沿", guidanceEN: "Down low, angled up along the underside of the rear bumper",
            framing: .detail,
            station: .init(azimuthDegrees: 180, height: .low, distance: .close),
            handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "roof", group: .exterior,
            titleZH: "车顶", titleEN: "Roof",
            guidanceZH: "手机举过头顶，听语音提示，不用看屏幕", guidanceEN: "Phone above your head — follow the spoken prompts, no need to look",
            framing: .wholeVehicle,
            station: .init(azimuthDegrees: 90, height: .overhead, distance: .medium),
            handsFree: true, requiresLegibleText: false
        ),
        .init(
            id: "windshield", group: .exterior,
            titleZH: "前挡风玻璃", titleEN: "Windshield",
            guidanceZH: "正对前挡，整块玻璃入框，注意别把自己照进去", guidanceEN: "Square to the windshield, whole pane in frame, mind your reflection",
            framing: .detail,
            station: .init(azimuthDegrees: 0, height: .eye, distance: .medium),
            handsFree: false, requiresLegibleText: false
        ),
    ]

    public static let interior: [ShotSlot] = [
        .init(
            id: "dashboard", group: .interior,
            titleZH: "仪表台全景", titleEN: "Dashboard",
            guidanceZH: "从驾驶位车门拍整个仪表台", guidanceEN: "From the driver's door, the whole dashboard",
            framing: .wholeVehicle, station: nil, handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "odometer", group: .interior,
            titleZH: "里程表", titleEN: "Odometer",
            guidanceZH: "点火后拍，数字必须清楚可读", guidanceEN: "Ignition on — the digits have to be readable",
            framing: .detail, station: nil, handsFree: false, requiresLegibleText: true
        ),
        .init(
            id: "fuel_gauge", group: .interior,
            titleZH: "油量 / 电量", titleEN: "Fuel or charge level",
            guidanceZH: "点火后拍，指针或百分比必须清楚", guidanceEN: "Ignition on — needle or percentage clearly visible",
            framing: .detail, station: nil, handsFree: false, requiresLegibleText: true
        ),
        .init(
            id: "front_seats", group: .interior,
            titleZH: "前排座椅", titleEN: "Front seats",
            guidanceZH: "两个前排座椅，注意座垫上的污渍和破损", guidanceEN: "Both front seats — look for stains and tears",
            framing: .wholeVehicle, station: nil, handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "rear_seats", group: .interior,
            titleZH: "后排座椅", titleEN: "Rear seats",
            guidanceZH: "整排后座，注意座垫和地毯", guidanceEN: "The full rear bench, seats and carpet",
            framing: .wholeVehicle, station: nil, handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "center_console", group: .interior,
            titleZH: "中控 / 换挡区", titleEN: "Centre console",
            guidanceZH: "中控台、换挡杆、杯架", guidanceEN: "Centre stack, shifter and cup holders",
            framing: .detail, station: nil, handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "headliner", group: .interior,
            titleZH: "车内顶棚", titleEN: "Headliner",
            guidanceZH: "车顶内衬，烟熏和污渍最常在这里起争议", guidanceEN: "The inner roof — smoke and staining disputes start here",
            framing: .wholeVehicle, station: nil, handsFree: false, requiresLegibleText: false
        ),
        .init(
            id: "trunk", group: .interior,
            titleZH: "后备厢", titleEN: "Trunk",
            guidanceZH: "打开后备厢拍内部，地板要看得见", guidanceEN: "Lid open, the boot floor visible",
            framing: .wholeVehicle, station: nil, handsFree: false, requiresLegibleText: false
        ),
    ]

    public static func slot(id: String) -> ShotSlot? {
        standard.first { $0.id == id }
    }
}
