import CoreGraphics
import ImageIO
import XCTest
@testable import EvidenceCore

/// The photographs are now built here rather than handed over finished, so
/// everything a claim needs out of a file is this file's responsibility.
/// These read the result back with the independent parser rather than with
/// ImageIO, for the reason `ExifReader` exists: ImageIO answers questions
/// about tags it synthesised as readily as about tags that are really there.
final class PhotoEncoderTests: XCTestCase {

    private func swatch(width: Int = 64, height: Int = 48) -> CGImage {
        let context = CGContext(
            data: nil, width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        )!
        context.setFillColor(CGColor(red: 0.2, green: 0.5, blue: 0.4, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.setFillColor(CGColor(red: 0.9, green: 0.9, blue: 0.9, alpha: 1))
        context.fill(CGRect(x: 8, y: 8, width: width / 3, height: height / 3))
        return context.makeImage()!
    }

    private func stamp(
        at moment: Date = Date(timeIntervalSince1970: 1_790_000_000),
        located: Bool = true
    ) -> CaptureStamp {
        CaptureStamp(
            capturedAt: moment,
            timeZone: TimeZone(identifier: "America/Vancouver")!,
            location: located
                ? CaptureLocation(latitude: 49.2827, longitude: -123.1207, altitude: 12, horizontalAccuracy: 5, timestamp: moment, source: .satellite)
                : nil,
            deviceMake: "Apple",
            deviceModel: "iPhone17,2",
            software: "Walkaround 0.1.0"
        )
    }

    // MARK: - It has to be a real JPEG

    func testItProducesAJpegAnImageReaderCanOpen() throws {
        let data = try PhotoEncoder.encode(image: swatch(), cameraProperties: [:], stamp: stamp())
        XCTAssertGreaterThan(data.count, 500)
        XCTAssertEqual([UInt8](data.prefix(2)), [0xFF, 0xD8], "not a JPEG")

        let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
        let decoded = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        XCTAssertEqual(decoded.width, 64)
        XCTAssertEqual(decoded.height, 48)
    }

    // MARK: - What a claim is actually checked for

    func testTheThreeThingsTuroRejectsAPhotographForArePresent() throws {
        let data = try PhotoEncoder.encode(image: swatch(), cameraProperties: [:], stamp: stamp())
        let exif = try XCTUnwrap(ExifReader(jpeg: data))

        let taken = try XCTUnwrap(exif.string(ExifReader.dateTimeOriginal, in: exif.exif))
        XCTAssertTrue(taken.hasPrefix("2026:"), taken)
        XCTAssertNotNil(exif.string(ExifReader.offsetTimeOriginal, in: exif.exif))
        XCTAssertFalse(exif.gps.isEmpty, "a photograph with no GPS is rejected unread")
    }

    func testWithNoFixItWritesNoGpsRatherThanAZero() throws {
        let data = try PhotoEncoder.encode(
            image: swatch(), cameraProperties: [:], stamp: stamp(located: false)
        )
        let exif = try XCTUnwrap(ExifReader(jpeg: data))
        XCTAssertTrue(exif.gps.isEmpty, "invented a coordinate nobody measured")
        // Still archived, still timed: the shot is evidence of something.
        XCTAssertNotNil(exif.string(ExifReader.dateTimeOriginal, in: exif.exif))
    }

    func testTheDeviceIsNamedInTheFile() throws {
        let data = try PhotoEncoder.encode(image: swatch(), cameraProperties: [:], stamp: stamp())
        let exif = try XCTUnwrap(ExifReader(jpeg: data))
        XCTAssertEqual(exif.string(ExifReader.make, in: exif.ifd0), "Apple")
        XCTAssertEqual(exif.string(ExifReader.model, in: exif.ifd0), "iPhone17,2")
        XCTAssertEqual(exif.string(ExifReader.software, in: exif.ifd0), "Walkaround 0.1.0")
    }

    // MARK: - The camera's own EXIF has to survive

    /// ⚠️ The shape of what the frame carries is not guaranteed by the SDK —
    /// "a dictionary of EXIF metadata" describes both of these. Handed the
    /// bare form unwrapped, ImageIO matches nothing and drops all of it
    /// without complaining, and the photographs come out looking perfectly
    /// normal with no exposure data in them at all.
    func testABareExifDictionaryIsWrappedRatherThanDropped() throws {
        let bare: [String: Any] = [
            kCGImagePropertyExifExposureTime as String: 0.008,
            kCGImagePropertyExifFNumber as String: 1.78,
            kCGImagePropertyExifISOSpeedRatings as String: [64],
        ]
        let data = try PhotoEncoder.encode(image: swatch(), cameraProperties: bare, stamp: stamp())
        let exif = try XCTUnwrap(ExifReader(jpeg: data))
        XCTAssertNotNil(exif.exif[ExifReader.exposureTime], "the camera's exposure was thrown away")
        XCTAssertNotNil(exif.exif[ExifReader.fNumber])
    }

    func testAnAlreadyNestedDictionaryIsPassedThroughUntouched() throws {
        let nested: [String: Any] = [
            kCGImagePropertyExifDictionary as String: [
                kCGImagePropertyExifExposureTime as String: 0.004,
            ],
        ]
        let data = try PhotoEncoder.encode(image: swatch(), cameraProperties: nested, stamp: stamp())
        let exif = try XCTUnwrap(ExifReader(jpeg: data))
        XCTAssertNotNil(exif.exif[ExifReader.exposureTime])
    }

    func testNormalisingRecognisesBothShapes() {
        let nested = [kCGImagePropertyTIFFDictionary as String: ["Make": "Apple"]]
        XCTAssertTrue(PhotoEncoder.normalised(nested).keys.contains(kCGImagePropertyTIFFDictionary as String))

        let bare = ["ExposureTime": 0.01]
        let wrapped = PhotoEncoder.normalised(bare)
        XCTAssertNotNil(wrapped[kCGImagePropertyExifDictionary as String])

        XCTAssertTrue(PhotoEncoder.normalised([:]).isEmpty)
    }

    /// The camera knows the exposure better than we do, so nothing this class
    /// adds may displace what the frame arrived with.
    func testTheCamerasOwnTimestampWins() throws {
        let camera: [String: Any] = [
            kCGImagePropertyExifDictionary as String: [
                kCGImagePropertyExifDateTimeOriginal as String: "2020:01:02 03:04:05",
            ],
        ]
        let data = try PhotoEncoder.encode(image: swatch(), cameraProperties: camera, stamp: stamp())
        let exif = try XCTUnwrap(ExifReader(jpeg: data))
        XCTAssertEqual(exif.string(ExifReader.dateTimeOriginal, in: exif.exif), "2020:01:02 03:04:05")
    }

    // MARK: - Orientation

    /// A rear sensor is mounted landscape and the app is locked to portrait,
    /// so every frame arrives on its side. The tag turns it; the pixels are
    /// never redrawn.
    func testItIsTaggedPortraitWithoutRedrawingAnything() throws {
        let data = try PhotoEncoder.encode(image: swatch(), cameraProperties: [:], stamp: stamp())
        let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any]
        XCTAssertEqual(properties?[kCGImagePropertyOrientation as String] as? UInt32, 6)

        let decoded = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        XCTAssertEqual(decoded.width, 64, "the pixels were rotated, which is a second lossy pass")
    }

    // MARK: - Size

    /// Quality is a volume decision as much as a quality one: the fleet's
    /// disk has filled up once already.
    func testQualityIsBelowTheWastefulEnd() {
        XCTAssertLessThan(PhotoEncoder.quality, 1.0)
        XCTAssertGreaterThanOrEqual(PhotoEncoder.quality, 0.85)
    }
}
