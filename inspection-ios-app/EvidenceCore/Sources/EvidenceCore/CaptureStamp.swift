import Foundation

/// Where a coordinate came from. Turo deems a claim photo invalid when its
/// metadata lacks date, time or geolocation, which makes it tempting to put
/// *something* in the GPS block. Do not. A fabricated fix is worse than an
/// absent one: absent metadata loses a claim, fabricated metadata loses the
/// argument that any of our evidence is genuine.
public enum LocationSource: String, Sendable, Codable {
    /// A GNSS fix from the device's own receiver.
    case satellite = "GPS"
    /// CoreLocation's fused estimate (GNSS + wifi + cell). Still a real
    /// measurement of where the phone was, just not pure satellite.
    case fused = "FUSED"

    /// The EXIF `GPSProcessingMethod` string. The format reserves "MANUAL"
    /// for hand-entered coordinates — we never emit it, because a phone
    /// always measures. The fixed-camera system in the carwash bay does
    /// emit MANUAL, and correctly so.
    public var exifProcessingMethod: String { rawValue }
}

/// A position the phone actually occupied when the shutter fired.
public struct CaptureLocation: Sendable, Codable, Equatable {
    public var latitude: Double
    public var longitude: Double
    /// Metres above sea level, when CoreLocation reported a usable vertical fix.
    public var altitude: Double?
    /// CoreLocation's own horizontal accuracy estimate, in metres. Recorded
    /// because "the phone was within 8m of here" is a defensible claim and
    /// "the phone was exactly here" is not.
    public var horizontalAccuracy: Double?
    /// When the fix itself was taken, which is not always when the shutter
    /// fired — a stale fix should read as stale.
    public var timestamp: Date
    public var source: LocationSource

    public init(
        latitude: Double,
        longitude: Double,
        altitude: Double? = nil,
        horizontalAccuracy: Double? = nil,
        timestamp: Date,
        source: LocationSource
    ) {
        self.latitude = latitude
        self.longitude = longitude
        self.altitude = altitude
        self.horizontalAccuracy = horizontalAccuracy
        self.timestamp = timestamp
        self.source = source
    }
}

/// The true facts about one capture, ready to be written into EXIF.
///
/// Every field here is measured, never assumed. `ExifStamper` will only ever
/// write values it is handed in this struct, and will leave a field out
/// entirely rather than invent it.
public struct CaptureStamp: Sendable, Equatable {
    public var capturedAt: Date
    /// The zone the phone was in. Without `OffsetTimeOriginal` a bare
    /// "14:03:21" is ambiguous by up to a day, and Turo's windows are
    /// counted in hours from trip start and trip end.
    public var timeZone: TimeZone
    /// nil when no usable fix was available. The capture is still archived;
    /// it is flagged as missing geolocation so nobody discovers the gap
    /// during a claim.
    public var location: CaptureLocation?
    public var deviceMake: String
    public var deviceModel: String
    public var software: String

    public init(
        capturedAt: Date,
        timeZone: TimeZone,
        location: CaptureLocation?,
        deviceMake: String,
        deviceModel: String,
        software: String
    ) {
        self.capturedAt = capturedAt
        self.timeZone = timeZone
        self.location = location
        self.deviceMake = deviceMake
        self.deviceModel = deviceModel
        self.software = software
    }
}
