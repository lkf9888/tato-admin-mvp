import Foundation

/// A standalone EXIF reader, written against the TIFF/EXIF layout rather than
/// against ImageIO.
///
/// It started as a test helper and belongs in the library, because the capture
/// pipeline has to answer the same question at runtime that the tests ask at
/// build time: did the metadata actually land in the file, in the IFDs a
/// stranger's parser will look at?
///
/// It exists because of a trap that is easy to fall into: ImageIO will happily
/// report a `kCGImagePropertyGPSDictionary` that it synthesised from an XMP
/// packet. Read back through the same framework that wrote it, a file with no
/// GPS IFD at all looks perfectly geotagged — and then the recipient's own
/// parser finds nothing. Turo's does not run ImageIO.
///
/// So the tests assert against these bytes, not against ImageIO's opinion of
/// them.
public struct ExifReader {
    public enum Value: Equatable {
        case ascii(String)
        case rationals([Double])
        case integer(Int)
        case unparsed
    }

    public private(set) var ifd0: [UInt16: Value] = [:]
    public private(set) var exif: [UInt16: Value] = [:]
    public private(set) var gps: [UInt16: Value] = [:]

    // IFD0
    public static let make: UInt16 = 0x010F
    public static let model: UInt16 = 0x0110
    public static let software: UInt16 = 0x0131
    public static let dateTime: UInt16 = 0x0132
    // Exif sub-IFD
    public static let dateTimeOriginal: UInt16 = 0x9003
    public static let dateTimeDigitized: UInt16 = 0x9004
    public static let offsetTimeOriginal: UInt16 = 0x9011
    // GPS IFD
    public static let gpsLatitudeRef: UInt16 = 0x0001
    public static let gpsLatitude: UInt16 = 0x0002
    public static let gpsLongitudeRef: UInt16 = 0x0003
    public static let gpsLongitude: UInt16 = 0x0004
    public static let gpsTimeStamp: UInt16 = 0x0007
    public static let gpsMapDatum: UInt16 = 0x0012
    public static let gpsProcessingMethod: UInt16 = 0x001B
    public static let gpsDateStamp: UInt16 = 0x001D

    private let bytes: [UInt8]
    private let tiffStart: Int
    private let littleEndian: Bool

    public init?(jpeg: Data) {
        let bytes = [UInt8](jpeg)
        // "Exif\0\0" introduces the APP1 segment that carries the TIFF block.
        let signature: [UInt8] = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]
        guard let signatureStart = ExifReader.find(signature, in: bytes) else { return nil }

        self.bytes = bytes
        tiffStart = signatureStart + signature.count
        guard tiffStart + 8 <= bytes.count else { return nil }
        switch (bytes[tiffStart], bytes[tiffStart + 1]) {
        case (0x49, 0x49): littleEndian = true
        case (0x4D, 0x4D): littleEndian = false
        default: return nil
        }

        let firstIFD = Int(u32(at: tiffStart + 4))
        ifd0 = readIFD(at: tiffStart + firstIFD)
        if case .integer(let pointer)? = ifd0[0x8769] { exif = readIFD(at: tiffStart + pointer) }
        if case .integer(let pointer)? = ifd0[0x8825] { gps = readIFD(at: tiffStart + pointer) }
    }

    public func string(_ tag: UInt16, in ifd: [UInt16: Value]) -> String? {
        if case .ascii(let text)? = ifd[tag] { return text }
        return nil
    }

    /// Degrees-minutes-seconds back to a signed decimal degree.
    public func coordinate(_ tag: UInt16, ref refTag: UInt16) -> Double? {
        guard case .rationals(let parts)? = gps[tag], parts.count == 3,
              let ref = string(refTag, in: gps) else { return nil }
        let degrees = parts[0] + parts[1] / 60 + parts[2] / 3600
        return (ref == "S" || ref == "W") ? -degrees : degrees
    }

    // MARK: - TIFF plumbing

    private func readIFD(at offset: Int) -> [UInt16: Value] {
        guard offset + 2 <= bytes.count else { return [:] }
        let count = Int(u16(at: offset))
        var entries: [UInt16: Value] = [:]

        for index in 0..<count {
            let entry = offset + 2 + index * 12
            guard entry + 12 <= bytes.count else { break }
            let tag = u16(at: entry)
            let type = u16(at: entry + 2)
            let componentCount = Int(u32(at: entry + 4))
            let inlineOrOffset = Int(u32(at: entry + 8))

            switch type {
            case 2:  // ASCII
                let size = componentCount
                let start = size <= 4 ? entry + 8 : tiffStart + inlineOrOffset
                guard start + size <= bytes.count, size > 0 else { entries[tag] = .unparsed; break }
                let raw = bytes[start..<(start + size)].prefix { $0 != 0 }
                entries[tag] = .ascii(String(decoding: raw, as: UTF8.self))
            case 3:  // SHORT
                entries[tag] = .integer(Int(u16(at: entry + 8)))
            case 4:  // LONG
                entries[tag] = .integer(inlineOrOffset)
            case 5, 10:  // RATIONAL / SRATIONAL
                var values: [Double] = []
                for component in 0..<componentCount {
                    let at = tiffStart + inlineOrOffset + component * 8
                    guard at + 8 <= bytes.count else { break }
                    let denominator = Double(u32(at: at + 4))
                    values.append(denominator == 0 ? 0 : Double(u32(at: at)) / denominator)
                }
                entries[tag] = .rationals(values)
            default:
                entries[tag] = .unparsed
            }
        }
        return entries
    }

    private func u16(at offset: Int) -> UInt16 {
        guard offset + 2 <= bytes.count else { return 0 }
        let a = UInt16(bytes[offset]), b = UInt16(bytes[offset + 1])
        return littleEndian ? (b << 8 | a) : (a << 8 | b)
    }

    private func u32(at offset: Int) -> UInt32 {
        guard offset + 4 <= bytes.count else { return 0 }
        let parts = (0..<4).map { UInt32(bytes[offset + $0]) }
        return littleEndian
            ? parts[3] << 24 | parts[2] << 16 | parts[1] << 8 | parts[0]
            : parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]
    }

    private static func find(_ needle: [UInt8], in haystack: [UInt8]) -> Int? {
        guard needle.count <= haystack.count else { return nil }
        for start in 0...(haystack.count - needle.count) where Array(haystack[start..<(start + needle.count)]) == needle {
            return start
        }
        return nil
    }
}

// MARK: - The fields a claim turns on

public extension ExifReader {
    var captureTime: String? { string(ExifReader.dateTimeOriginal, in: exif) }
    var utcOffset: String? { string(ExifReader.offsetTimeOriginal, in: exif) }
    var cameraMake: String? { string(ExifReader.make, in: ifd0) }
    var cameraModel: String? { string(ExifReader.model, in: ifd0) }
    var software: String? { string(ExifReader.software, in: ifd0) }

    var latitude: Double? { coordinate(ExifReader.gpsLatitude, ref: ExifReader.gpsLatitudeRef) }
    var longitude: Double? { coordinate(ExifReader.gpsLongitude, ref: ExifReader.gpsLongitudeRef) }

    /// A GPS IFD with a usable pair of coordinates in it. An empty or
    /// half-written GPS block does not count.
    var hasLocation: Bool { latitude != nil && longitude != nil }

    /// The capture time as an instant, combining the local timestamp with its
    /// offset. Nil without the offset, because a local time on its own names
    /// a different instant in every zone and guessing one would be inventing
    /// the very fact a 24-hour window turns on.
    var capturedAt: Date? {
        guard let local = captureTime, let offset = utcOffset else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy:MM:dd HH:mm:ssZZZZZ"
        return formatter.date(from: local + offset)
    }
}
