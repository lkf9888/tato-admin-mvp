import Foundation
import ImageIO
import CoreGraphics

public enum ExifStampError: Error, Equatable {
    case unreadableImage
    case notJPEG(String)
    case destinationUnavailable
    case fieldRejected(String)
    case copyFailed(String)
}

public struct ExifStampResult: Sendable {
    /// The file to archive. When nothing needed filling in, this is the
    /// camera's bytes, unchanged.
    public let data: Data
    /// EXIF paths this call supplied, e.g. `GPS.Latitude`. Empty means the
    /// camera had already recorded everything and the file passed through.
    public let filledIn: [String]
    /// False means the picture itself was re-compressed on the way through.
    /// **The capture pipeline must refuse to archive such a file** — it is no
    /// longer the original, and an opponent only has to notice once.
    public let imageDataUnchanged: Bool
}

/// Fills the metadata an iPhone capture does not write on its own — chiefly
/// GPS — without re-encoding the image.
///
/// On device this is the *fallback* path. The primary path is to hand
/// AVFoundation the replacement metadata at capture time, so the file is
/// written once, already complete, and never rewritten at all. This exists
/// for files that arrive already encoded, and as the place where the rules
/// below are expressed in code and tested.
///
/// Three rules, in order of how badly breaking them ends:
///
/// 1. **Only ever write measured values.** Every field comes from
///    `CaptureStamp`, which comes from the clock and CoreLocation. A field
///    with no measurement behind it is left out.
/// 2. **Never overwrite what the camera recorded.** AVFoundation's own
///    `DateTimeOriginal` is the authoritative one; ours is a fallback for
///    when it is somehow absent. Two disagreeing timestamps in one file is an
///    invitation to have the whole archive questioned.
/// 3. **Hash after this, never before.** The SHA-256 has to cover the final
///    bytes. `EvidenceHash` documents the same rule from the other side.
///
/// Never run this over already-archived photos. The values might be right and
/// the file would still stop being the original, which is the one property
/// the archive exists to provide.
public enum ExifStamper {

    public static func stamp(jpeg: Data, with stamp: CaptureStamp) throws -> ExifStampResult {
        guard let source = CGImageSourceCreateWithData(jpeg as CFData, nil) else {
            throw ExifStampError.unreadableImage
        }
        let type = (CGImageSourceGetType(source) as String?) ?? "unknown"
        guard type == "public.jpeg" else { throw ExifStampError.notJPEG(type) }

        let existing = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
        let fields = missingFields(existing: existing, stamp: stamp)

        // Nothing to add. Handing back the camera's own bytes is strictly
        // better than a rewrite that happens to be faithful.
        guard !fields.isEmpty else {
            return ExifStampResult(data: jpeg, filledIn: [], imageDataUnchanged: true)
        }

        let metadata = CGImageMetadataCreateMutable()
        for field in fields {
            guard CGImageMetadataSetValueMatchingImageProperty(
                metadata, field.dictionary, field.property, field.value as CFTypeRef
            ) else {
                // Dropping a field silently is how an archive ends up with
                // photos that are missing exactly the tag a claim turns on.
                throw ExifStampError.fieldRejected(field.label)
            }
        }

        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, type as CFString, 1, nil) else {
            throw ExifStampError.destinationUnavailable
        }

        var error: Unmanaged<CFError>?
        // `CopyImageSource` rewrites the metadata segments and copies the
        // compressed image data across untouched. The alternatives do not:
        // `AddImageFromSource` re-encodes (measured — the entropy-coded scan
        // came back 11% shorter), and going through a CGImage re-encodes by
        // definition. `MergeMetadata` keeps whatever the camera already wrote.
        guard CGImageDestinationCopyImageSource(destination, source, [
            kCGImageDestinationMetadata: metadata,
            kCGImageDestinationMergeMetadata: kCFBooleanTrue as Any,
        ] as CFDictionary, &error) else {
            let message = (error?.takeRetainedValue()).map { String(describing: $0) } ?? "unknown"
            throw ExifStampError.copyFailed(message)
        }

        let stamped = output as Data
        return ExifStampResult(
            data: stamped,
            filledIn: fields.map(\.label),
            imageDataUnchanged: JPEGIntegrity.imageDataIsIdentical(jpeg, stamped)
        )
    }

    // MARK: - Deciding what is missing

    private struct Field {
        let dictionary: CFString
        let property: CFString
        let value: Any
        let label: String
    }

    private static func missingFields(existing: [CFString: Any], stamp: CaptureStamp) -> [Field] {
        let exif = existing[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
        let tiff = existing[kCGImagePropertyTIFFDictionary] as? [CFString: Any] ?? [:]
        let gps = existing[kCGImagePropertyGPSDictionary] as? [CFString: Any] ?? [:]

        let local = localTimestamp(stamp.capturedAt, in: stamp.timeZone)
        let offset = utcOffset(stamp.capturedAt, in: stamp.timeZone)

        var fields: [Field] = []

        func addIfMissing(_ current: [CFString: Any], _ dict: CFString, _ key: CFString, _ value: Any, _ label: String) {
            guard current[key] == nil else { return }
            fields.append(Field(dictionary: dict, property: key, value: value, label: label))
        }

        addIfMissing(exif, kCGImagePropertyExifDictionary, kCGImagePropertyExifDateTimeOriginal, local, "EXIF.DateTimeOriginal")
        addIfMissing(exif, kCGImagePropertyExifDictionary, kCGImagePropertyExifDateTimeDigitized, local, "EXIF.DateTimeDigitized")
        addIfMissing(exif, kCGImagePropertyExifDictionary, kCGImagePropertyExifOffsetTimeOriginal, offset, "EXIF.OffsetTimeOriginal")
        addIfMissing(exif, kCGImagePropertyExifDictionary, kCGImagePropertyExifOffsetTimeDigitized, offset, "EXIF.OffsetTimeDigitized")
        addIfMissing(exif, kCGImagePropertyExifDictionary, kCGImagePropertyExifOffsetTime, offset, "EXIF.OffsetTime")

        addIfMissing(tiff, kCGImagePropertyTIFFDictionary, kCGImagePropertyTIFFMake, stamp.deviceMake, "TIFF.Make")
        addIfMissing(tiff, kCGImagePropertyTIFFDictionary, kCGImagePropertyTIFFModel, stamp.deviceModel, "TIFF.Model")
        addIfMissing(tiff, kCGImagePropertyTIFFDictionary, kCGImagePropertyTIFFSoftware, stamp.software, "TIFF.Software")
        addIfMissing(tiff, kCGImagePropertyTIFFDictionary, kCGImagePropertyTIFFDateTime, local, "TIFF.DateTime")

        // No fix, no GPS block. Turo treats a photo without geolocation as
        // invalid, and that is the correct outcome here — the fix is to get a
        // fix, not to write one.
        guard let location = stamp.location, gps[kCGImagePropertyGPSLatitude] == nil else {
            return fields
        }

        fields.append(contentsOf: [
            Field(dictionary: kCGImagePropertyGPSDictionary, property: kCGImagePropertyGPSLatitude,
                  value: abs(location.latitude), label: "GPS.Latitude"),
            Field(dictionary: kCGImagePropertyGPSDictionary, property: kCGImagePropertyGPSLatitudeRef,
                  value: location.latitude >= 0 ? "N" : "S", label: "GPS.LatitudeRef"),
            Field(dictionary: kCGImagePropertyGPSDictionary, property: kCGImagePropertyGPSLongitude,
                  value: abs(location.longitude), label: "GPS.Longitude"),
            Field(dictionary: kCGImagePropertyGPSDictionary, property: kCGImagePropertyGPSLongitudeRef,
                  value: location.longitude >= 0 ? "E" : "W", label: "GPS.LongitudeRef"),
            Field(dictionary: kCGImagePropertyGPSDictionary, property: kCGImagePropertyGPSMapDatum,
                  value: "WGS-84", label: "GPS.MapDatum"),
            // One ISO 8601 instant in UTC, which ImageIO splits into
            // GPSDateStamp and GPSTimeStamp on the way out.
            //
            // ⚠️ Not the EXIF-native "yyyy:MM:dd" / "HH:mm:ss" pair, and not
            // GPSDateStamp on its own. Both were measured writing **wrong
            // values** into the GPS IFD — a date of `1900:01:00`, and a
            // fabricated time of 20:00:00 — while reporting success. A
            // timestamp that is merely absent costs nothing; one that is
            // present and wrong is a false statement in an evidence file.
            Field(dictionary: kCGImagePropertyGPSDictionary, property: kCGImagePropertyGPSTimeStamp,
                  value: iso8601UTC(location.timestamp), label: "GPS.TimeStamp"),
        ])

        // `GPSProcessingMethod` is deliberately not written. ImageIO's
        // property-to-XMP mapping silently drops it — measured across four
        // encodings, tag 0x001B never reached the GPS IFD. Rather than
        // pretend, the fix source is recorded in our own manifest alongside
        // the SHA-256, where it can be stated precisely. An absent tag claims
        // nothing; that is the point.

        if let altitude = location.altitude {
            fields.append(Field(dictionary: kCGImagePropertyGPSDictionary, property: kCGImagePropertyGPSAltitude,
                                value: abs(altitude), label: "GPS.Altitude"))
            fields.append(Field(dictionary: kCGImagePropertyGPSDictionary, property: kCGImagePropertyGPSAltitudeRef,
                                value: altitude >= 0 ? 0 : 1, label: "GPS.AltitudeRef"))
        }
        if let accuracy = location.horizontalAccuracy {
            fields.append(Field(dictionary: kCGImagePropertyGPSDictionary, property: kCGImagePropertyGPSHPositioningError,
                                value: accuracy, label: "GPS.HPositioningError"))
        }

        return fields
    }

    // MARK: - Formatting

    private static func localTimestamp(_ date: Date, in zone: TimeZone) -> String {
        formatter(zone, "yyyy:MM:dd HH:mm:ss").string(from: date)
    }

    private static func iso8601UTC(_ date: Date) -> String {
        formatter(TimeZone(secondsFromGMT: 0)!, "yyyy-MM-dd'T'HH:mm:ss'Z'").string(from: date)
    }

    private static func formatter(_ zone: TimeZone, _ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = format
        return formatter
    }

    private static func utcOffset(_ date: Date, in zone: TimeZone) -> String {
        let seconds = zone.secondsFromGMT(for: date)
        let sign = seconds < 0 ? "-" : "+"
        let minutes = abs(seconds) / 60
        return String(format: "%@%02d:%02d", sign, minutes / 60, minutes % 60)
    }
}
