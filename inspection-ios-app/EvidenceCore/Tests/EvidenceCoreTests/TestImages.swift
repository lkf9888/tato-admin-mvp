@testable import EvidenceCore
import Foundation
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

/// Synthetic JPEGs, built in memory. Deliberately not checked-in binaries:
/// a fixture nobody can read the provenance of is the wrong thing to have in
/// a repository about provenance.
enum TestImages {

    static func checkerboard(
        width: Int = 600,
        height: Int = 400,
        cell: Int = 8,
        blurPasses: Int = 0,
        properties: [CFString: Any] = [:]
    ) -> Data {
        checkerboard(
            width: width, height: height, cell: cell, blurPasses: blurPasses,
            stringProperties: Dictionary(uniqueKeysWithValues: properties.map { ($0.key as String, $0.value) })
        )
    }

    /// The same, taking the `[String: Any]` shape AVFoundation and
    /// `CaptureMetadata` deal in.
    static func checkerboard(
        width: Int = 600,
        height: Int = 400,
        cell: Int = 8,
        blurPasses: Int = 0,
        stringProperties: [String: Any]
    ) -> Data {
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        for y in 0..<height {
            for x in 0..<width {
                let dark = ((x / cell) + (y / cell)) % 2 == 0
                let value: UInt8 = dark ? 30 : 225
                let index = (y * width + x) * 4
                pixels[index] = value
                pixels[index + 1] = value
                pixels[index + 2] = value
                pixels[index + 3] = 255
            }
        }
        for _ in 0..<blurPasses {
            pixels = boxBlur(pixels, width: width, height: height)
        }
        return encode(pixels: pixels, width: width, height: height, properties: stringProperties)
    }

    /// A 3x3 mean filter. Repeated passes approximate a defocus well enough to
    /// tell a sharp frame from a soft one, which is all these tests claim.
    private static func boxBlur(_ source: [UInt8], width: Int, height: Int) -> [UInt8] {
        var output = source
        for y in 1..<(height - 1) {
            for x in 1..<(width - 1) {
                for channel in 0..<3 {
                    var total = 0
                    for dy in -1...1 {
                        for dx in -1...1 {
                            total += Int(source[((y + dy) * width + (x + dx)) * 4 + channel])
                        }
                    }
                    output[(y * width + x) * 4 + channel] = UInt8(total / 9)
                }
            }
        }
        return output
    }

    private static func encode(
        pixels: [UInt8],
        width: Int,
        height: Int,
        properties: [String: Any]
    ) -> Data {
        var buffer = pixels
        let image: CGImage? = buffer.withUnsafeMutableBytes { raw in
            guard let context = CGContext(
                data: raw.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return nil }
            return context.makeImage()
        }
        guard let image else { fatalError("could not build the test bitmap") }

        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output, UTType.jpeg.identifier as CFString, 1, nil
        ) else { fatalError("could not open a JPEG destination") }

        var options = properties
        options[kCGImageDestinationLossyCompressionQuality as String] = 0.95
        CGImageDestinationAddImage(destination, image, options as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { fatalError("could not encode the test JPEG") }
        return output as Data
    }

    static func properties(of jpeg: Data) -> [CFString: Any] {
        guard let source = CGImageSourceCreateWithData(jpeg as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        else { return [:] }
        return properties
    }

    static func exif(of jpeg: Data) -> [CFString: Any] {
        properties(of: jpeg)[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
    }

    static func gps(of jpeg: Data) -> [CFString: Any] {
        properties(of: jpeg)[kCGImagePropertyGPSDictionary] as? [CFString: Any] ?? [:]
    }

    static func tiff(of jpeg: Data) -> [CFString: Any] {
        properties(of: jpeg)[kCGImagePropertyTIFFDictionary] as? [CFString: Any] ?? [:]
    }
}

extension CaptureStamp {
    static func fixture(
        capturedAt: Date = Date(timeIntervalSince1970: 1_789_000_000),
        timeZone: TimeZone = TimeZone(identifier: "America/Vancouver")!,
        location: CaptureLocation? = .fixture()
    ) -> CaptureStamp {
        CaptureStamp(
            capturedAt: capturedAt,
            timeZone: timeZone,
            location: location,
            deviceMake: "Apple",
            deviceModel: "iPhone 16 Pro",
            software: "Walkaround 0.1.0"
        )
    }
}

extension CaptureLocation {
    static func fixture(
        latitude: Double = 49.192139,
        longitude: Double = -123.128917
    ) -> CaptureLocation {
        CaptureLocation(
            latitude: latitude,
            longitude: longitude,
            altitude: 5,
            horizontalAccuracy: 4.7,
            timestamp: Date(timeIntervalSince1970: 1_789_000_000),
            source: .satellite
        )
    }
}
