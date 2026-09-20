import Foundation
import ImageIO

/// Builds the metadata AVFoundation should write *while* it flattens a photo
/// to a file, so the file is correct the first time and never rewritten.
///
/// This is the primary path. `ExifStamper` is the fallback for files that
/// arrive already encoded, and the two deliberately differ in one respect:
///
/// | | writer | GPS date/time format |
/// |---|---|---|
/// | here | AVFoundation, straight to EXIF | EXIF-native `yyyy:MM:dd` + `HH:mm:ss` |
/// | `ExifStamper` | ImageIO, via its XMP mapping | ISO 8601, because the native form is corrupted on that path |
///
/// That asymmetry is not a mistake and not a preference. It is two different
/// writers with two different bugs, and **which one is right on a given phone
/// is settled at runtime, not here**: the capture pipeline reads the finished
/// file back with `ExifReader` and falls back to the stamper if what it asked
/// for did not land. Never change one of these to match the other on the
/// grounds of consistency.
public enum CaptureMetadata {

    /// Merges the true capture facts into whatever AVFoundation already
    /// gathered, without displacing any of it.
    ///
    /// The camera's own EXIF is authoritative — it knows the exposure, the
    /// lens and the instant better than we do. All this adds is what the
    /// camera does not record on its own, which in practice means GPS.
    public static func replacement(for existing: [String: Any], with stamp: CaptureStamp) -> [String: Any] {
        var metadata = existing
        var exif = existing[kCGImagePropertyExifDictionary as String] as? [String: Any] ?? [:]
        var tiff = existing[kCGImagePropertyTIFFDictionary as String] as? [String: Any] ?? [:]

        let local = Self.local(stamp.capturedAt, in: stamp.timeZone)
        let offset = Self.offset(stamp.capturedAt, in: stamp.timeZone)

        fill(&exif, kCGImagePropertyExifDateTimeOriginal, local)
        fill(&exif, kCGImagePropertyExifDateTimeDigitized, local)
        fill(&exif, kCGImagePropertyExifOffsetTimeOriginal, offset)
        fill(&exif, kCGImagePropertyExifOffsetTimeDigitized, offset)
        fill(&exif, kCGImagePropertyExifOffsetTime, offset)

        fill(&tiff, kCGImagePropertyTIFFMake, stamp.deviceMake)
        fill(&tiff, kCGImagePropertyTIFFModel, stamp.deviceModel)
        fill(&tiff, kCGImagePropertyTIFFSoftware, stamp.software)
        fill(&tiff, kCGImagePropertyTIFFDateTime, local)

        metadata[kCGImagePropertyExifDictionary as String] = exif
        metadata[kCGImagePropertyTIFFDictionary as String] = tiff

        // No fix, no GPS block — the capture is archived and flagged rather
        // than decorated with a coordinate nobody measured.
        if let location = stamp.location {
            let existingGPS = existing[kCGImagePropertyGPSDictionary as String] as? [String: Any] ?? [:]
            if existingGPS[kCGImagePropertyGPSLatitude as String] == nil {
                metadata[kCGImagePropertyGPSDictionary as String] = gpsDictionary(for: location)
            }
        }

        return metadata
    }

    private static func gpsDictionary(for location: CaptureLocation) -> [String: Any] {
        var gps: [String: Any] = [
            kCGImagePropertyGPSLatitude as String: abs(location.latitude),
            kCGImagePropertyGPSLatitudeRef as String: location.latitude >= 0 ? "N" : "S",
            kCGImagePropertyGPSLongitude as String: abs(location.longitude),
            kCGImagePropertyGPSLongitudeRef as String: location.longitude >= 0 ? "E" : "W",
            kCGImagePropertyGPSMapDatum as String: "WGS-84",
            // UTC by specification, unlike the EXIF timestamps above.
            kCGImagePropertyGPSDateStamp as String: utc(location.timestamp, "yyyy:MM:dd"),
            kCGImagePropertyGPSTimeStamp as String: utc(location.timestamp, "HH:mm:ss.SS"),
            // The phone measured this. "MANUAL" would be a lie here, and is
            // reserved for the fixed cameras in the wash bay.
            kCGImagePropertyGPSProcessingMethod as String: location.source.exifProcessingMethod,
        ]
        if let altitude = location.altitude {
            gps[kCGImagePropertyGPSAltitude as String] = abs(altitude)
            gps[kCGImagePropertyGPSAltitudeRef as String] = altitude >= 0 ? 0 : 1
        }
        if let accuracy = location.horizontalAccuracy {
            gps[kCGImagePropertyGPSHPositioningError as String] = accuracy
        }
        return gps
    }

    private static func fill(_ dictionary: inout [String: Any], _ key: CFString, _ value: String) {
        guard dictionary[key as String] == nil else { return }
        dictionary[key as String] = value
    }

    private static func local(_ date: Date, in zone: TimeZone) -> String {
        formatter(zone, "yyyy:MM:dd HH:mm:ss").string(from: date)
    }

    private static func utc(_ date: Date, _ format: String) -> String {
        formatter(TimeZone(secondsFromGMT: 0)!, format).string(from: date)
    }

    private static func formatter(_ zone: TimeZone, _ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = format
        return formatter
    }

    private static func offset(_ date: Date, in zone: TimeZone) -> String {
        let seconds = zone.secondsFromGMT(for: date)
        let sign = seconds < 0 ? "-" : "+"
        let minutes = abs(seconds) / 60
        return String(format: "%@%02d:%02d", sign, minutes / 60, minutes % 60)
    }
}
