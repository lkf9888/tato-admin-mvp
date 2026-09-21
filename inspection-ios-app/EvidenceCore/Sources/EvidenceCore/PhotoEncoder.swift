import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

public enum PhotoEncodeError: Error, Equatable {
    case destinationUnavailable
    case writeFailed
}

/// Makes the JPEG, when nobody else is going to.
///
/// ## Why this exists at all
///
/// The photographs used to come out of `AVCapturePhotoOutput`, which hands
/// back a finished file the camera itself wrote — the strongest thing an
/// evidence app can hold. That is not available here. ARKit and a separate
/// capture session cannot both have the back camera, and the coverage
/// diagram needs ARKit, so the photographs now come from
/// `ARSession.captureHighResolutionFrame`. That returns pixels and a
/// dictionary, not a file.
///
/// ## What is and is not given up
///
/// **Kept:** the pixels are the camera's own processed output at full still
/// resolution — its exposure, its white balance, its noise reduction. The
/// EXIF is the camera's too, read off the frame. Time, timezone and GPS are
/// written the same way and by the same code as on the old path, the digest
/// is taken over the finished bytes, and the server re-derives all of it.
///
/// **Given up:** the sentence "this file was written by the camera". This is
/// a first encode, never a re-encode — there is no earlier JPEG whose scan
/// data could be disturbed, so `JPEGIntegrity` has nothing to compare and
/// does not apply. But the quantisation tables are ours, and a file says so
/// to anyone who looks. `MetadataPath.encodedFromCameraPixels` records that
/// on every shot rather than letting the archive imply otherwise.
public enum PhotoEncoder {

    /// Deliberately not 1.0.
    ///
    /// A claim assessor needs to see a scratch, not count sensor photons,
    /// and the difference between 0.9 and 1.0 is invisible at any zoom a
    /// person uses while costing roughly double the bytes. Volume is not a
    /// theoretical concern here: the fleet's disk has filled up once
    /// already, and a walk-around is dozens of these.
    public static let quality = 0.9

    /// The rear camera's sensor is mounted landscape, and this app is locked
    /// to portrait, so a frame arrives on its side. 6 is "rotate 90° clockwise
    /// to display", which is what every iPhone writes into a portrait
    /// photograph — the pixels stay as the sensor read them and the viewer
    /// turns them.
    ///
    /// ⚠️ Rotating the pixels instead would be a second, lossy pass over the
    /// image for no gain. Nothing here ever redraws what the camera saw.
    public static let portraitOrientation: UInt32 = 6

    /// Encodes one frame into a JPEG carrying the camera's own EXIF plus the
    /// facts the camera does not record.
    ///
    /// `cameraProperties` is whatever the frame came with. ARKit's
    /// `exifData` is documented only as "a dictionary of EXIF metadata",
    /// which leaves two plausible shapes, so both are accepted — see
    /// `normalised`.
    public static func encode(
        image: CGImage,
        cameraProperties: [String: Any],
        stamp: CaptureStamp,
        orientation: UInt32 = portraitOrientation
    ) throws -> Data {
        var properties = CaptureMetadata.replacement(for: normalised(cameraProperties), with: stamp)
        properties[kCGImagePropertyOrientation as String] = orientation
        properties[kCGImageDestinationLossyCompressionQuality as String] = quality

        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output as CFMutableData,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            throw PhotoEncodeError.destinationUnavailable
        }

        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            throw PhotoEncodeError.writeFailed
        }
        return output as Data
    }

    /// Accepts either shape of camera metadata and returns the nested one
    /// ImageIO expects.
    ///
    /// A properties dictionary has `{Exif}`, `{TIFF}`, `{GPS}` sub-dictionaries;
    /// a bare EXIF dictionary has `ExposureTime`, `FNumber` and friends at the
    /// top level. Handed the second shape unwrapped, ImageIO silently writes
    /// none of it — the tags are not top-level properties, so they match
    /// nothing and are dropped without an error. The photographs would come
    /// out looking fine and carrying no exposure data at all.
    static func normalised(_ properties: [String: Any]) -> [String: Any] {
        let nestedKeys = [
            kCGImagePropertyExifDictionary,
            kCGImagePropertyTIFFDictionary,
            kCGImagePropertyGPSDictionary,
        ].map { $0 as String }

        if properties.keys.contains(where: nestedKeys.contains) {
            return properties
        }
        guard !properties.isEmpty else { return [:] }
        return [kCGImagePropertyExifDictionary as String: properties]
    }
}
