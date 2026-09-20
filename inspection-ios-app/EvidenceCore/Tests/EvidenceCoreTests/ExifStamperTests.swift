import XCTest
import ImageIO
@testable import EvidenceCore

/// These assertions read the EXIF bytes with `ExifReader` rather than with
/// ImageIO. Asking the framework that wrote a file whether it wrote the file
/// proves nothing: it will reconstruct a GPS dictionary out of an XMP packet
/// and report success on a photo with no GPS IFD in it at all.
final class ExifStamperTests: XCTestCase {

    /// The load-bearing claim of the whole archive: adding metadata leaves the
    /// picture itself untouched.
    ///
    /// This is not theoretical. `CGImageDestinationAddImageFromSource`, the
    /// obvious API for the job, re-encoded the scan 11% shorter in this very
    /// test — metadata intact, pixels silently rewritten, which is the worst
    /// possible combination because it looks fine.
    func testStampingLeavesTheCompressedImageDataUntouched() throws {
        let original = TestImages.checkerboard()
        let result = try ExifStamper.stamp(jpeg: original, with: .fixture())

        XCTAssertNotEqual(result.data, original, "the GPS block should have been added")
        XCTAssertTrue(result.imageDataUnchanged)
        XCTAssertTrue(JPEGIntegrity.imageDataIsIdentical(original, result.data))
    }

    func testGPSLandsInTheGPSIFDWhereEveryReaderLooks() throws {
        let result = try ExifStamper.stamp(jpeg: TestImages.checkerboard(), with: .fixture())
        let exif = try XCTUnwrap(ExifReader(jpeg: result.data))

        let latitude = try XCTUnwrap(exif.coordinate(ExifReader.gpsLatitude, ref: ExifReader.gpsLatitudeRef))
        let longitude = try XCTUnwrap(exif.coordinate(ExifReader.gpsLongitude, ref: ExifReader.gpsLongitudeRef))
        // EXIF stores coordinates as degrees/minutes/seconds rationals, so a
        // round trip lands within centimetres rather than exactly.
        XCTAssertEqual(latitude, 49.192139, accuracy: 0.00001)
        XCTAssertEqual(longitude, -123.128917, accuracy: 0.00001)

        XCTAssertEqual(exif.string(ExifReader.gpsMapDatum, in: exif.gps), "WGS-84")
        // UTC by specification, so a day later than the Vancouver wall clock.
        XCTAssertEqual(exif.string(ExifReader.gpsDateStamp, in: exif.gps), "2026:09:10")
        XCTAssertEqual(exif.gps[ExifReader.gpsTimeStamp], .rationals([0, 26, 40]))
    }

    /// A phone always measures its position, so it must never emit the
    /// "MANUAL" processing method — that is reserved for the fixed cameras in
    /// the wash bay, whose coordinates are typed in by hand.
    ///
    /// ImageIO drops tag 0x001B entirely on this path, so in practice the tag
    /// is absent rather than set to "GPS". Absent is fine; wrong is not. The
    /// fix source is recorded in the manifest instead.
    func testNeverClaimsAManualFix() throws {
        let result = try ExifStamper.stamp(jpeg: TestImages.checkerboard(), with: .fixture())
        let exif = try XCTUnwrap(ExifReader(jpeg: result.data))

        XCTAssertNotEqual(exif.string(ExifReader.gpsProcessingMethod, in: exif.gps), "MANUAL")
        XCTAssertEqual(CaptureStamp.fixture().location?.source, .satellite)
    }

    /// No fix, no GPS block. An invented coordinate would sail through Turo's
    /// automated check and lose the argument the first time anyone looked.
    func testWithoutAFixNoGPSBlockIsWritten() throws {
        let result = try ExifStamper.stamp(jpeg: TestImages.checkerboard(), with: .fixture(location: nil))
        let exif = try XCTUnwrap(ExifReader(jpeg: result.data))

        XCTAssertTrue(exif.gps.isEmpty, "a photo with no fix must carry no GPS IFD")
        XCTAssertFalse(result.filledIn.contains { $0.hasPrefix("GPS") })
    }

    func testWritesLocalTimeWithItsOffset() throws {
        let result = try ExifStamper.stamp(jpeg: TestImages.checkerboard(), with: .fixture())
        let exif = try XCTUnwrap(ExifReader(jpeg: result.data))

        // 1789000000 is 2026-09-10 00:26:40 UTC and 2026-09-09 17:26:40 in
        // Vancouver. Same instant, different calendar day — which is exactly
        // why a capture time without its offset cannot settle a 24-hour window.
        XCTAssertEqual(exif.string(ExifReader.dateTimeOriginal, in: exif.exif), "2026:09:09 17:26:40")
        XCTAssertEqual(exif.string(ExifReader.offsetTimeOriginal, in: exif.exif), "-07:00")
        XCTAssertEqual(exif.string(ExifReader.dateTime, in: exif.ifd0), "2026:09:09 17:26:40")
    }

    func testWritesTheDeviceThatTookIt() throws {
        let result = try ExifStamper.stamp(jpeg: TestImages.checkerboard(), with: .fixture())
        let exif = try XCTUnwrap(ExifReader(jpeg: result.data))

        XCTAssertEqual(exif.string(ExifReader.make, in: exif.ifd0), "Apple")
        XCTAssertEqual(exif.string(ExifReader.model, in: exif.ifd0), "iPhone 16 Pro")
        XCTAssertEqual(exif.string(ExifReader.software, in: exif.ifd0), "Walkaround 0.1.0")
    }

    /// AVFoundation's own timestamp is the authoritative one. Two disagreeing
    /// capture times in one file would undermine every other file too.
    func testDoesNotOverwriteWhatTheCameraAlreadyRecorded() throws {
        let cameraTime = "2026:01:02 03:04:05"
        let original = TestImages.checkerboard(properties: [
            kCGImagePropertyExifDictionary: [
                kCGImagePropertyExifDateTimeOriginal: cameraTime,
                kCGImagePropertyExifOffsetTimeOriginal: "+08:00",
            ] as [CFString: Any],
            kCGImagePropertyTIFFDictionary: [
                kCGImagePropertyTIFFModel: "iPhone 14 Pro",
            ] as [CFString: Any],
        ])

        let result = try ExifStamper.stamp(jpeg: original, with: .fixture())
        let exif = try XCTUnwrap(ExifReader(jpeg: result.data))

        XCTAssertEqual(exif.string(ExifReader.dateTimeOriginal, in: exif.exif), cameraTime)
        XCTAssertEqual(exif.string(ExifReader.offsetTimeOriginal, in: exif.exif), "+08:00")
        XCTAssertEqual(exif.string(ExifReader.model, in: exif.ifd0), "iPhone 14 Pro")
        XCTAssertFalse(result.filledIn.contains("EXIF.DateTimeOriginal"))
    }

    /// Stamping a file that already has everything must hand back the camera's
    /// bytes rather than a faithful-looking rewrite.
    func testSecondStampIsAPassThrough() throws {
        let once = try ExifStamper.stamp(jpeg: TestImages.checkerboard(), with: .fixture())
        let twice = try ExifStamper.stamp(jpeg: once.data, with: .fixture())

        XCTAssertEqual(twice.data, once.data)
        XCTAssertTrue(twice.filledIn.isEmpty)
        XCTAssertEqual(EvidenceHash.sha256(twice.data), EvidenceHash.sha256(once.data))
    }

    func testRejectsAnythingThatIsNotAJPEG() {
        XCTAssertThrowsError(try ExifStamper.stamp(jpeg: Data("not an image".utf8), with: .fixture())) { error in
            // ImageIO opens a source over any bytes at all; it just cannot
            // name the format. That is the signal we reject on.
            XCTAssertEqual(error as? ExifStampError, .notJPEG("unknown"))
        }
    }
}
