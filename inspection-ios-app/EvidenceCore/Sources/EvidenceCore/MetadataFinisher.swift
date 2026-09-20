import Foundation

public enum MetadataFinishError: Error, Equatable {
    /// The fallback stamper re-compressed the picture. Nothing is archived:
    /// a re-encoded "original" is the exact thing this app exists to prevent,
    /// and shipping one quietly would be worse than losing the shot.
    case imageDataWouldChange
}

/// Decides, per photograph, whether AVFoundation got the metadata right —
/// and quietly repairs it when it did not.
///
/// The camera is asked to write the metadata as it flattens the photo, which
/// produces a file that is correct the first time and never rewritten. That
/// is the good path and it should be almost every photo. But which metadata a
/// given iOS version honours is not something to assume: the same task on the
/// ImageIO side was measured writing a **wrong** GPS date while reporting
/// success. So the finished bytes are read back and checked, on the device,
/// per shot, and the answer is recorded in the manifest rather than assumed.
///
/// `ExifStamper` fills only what is missing and hands back the original bytes
/// when nothing is, so the good path costs one EXIF parse and no rewrite.
public enum MetadataFinisher {

    public struct Outcome: Sendable {
        public let data: Data
        public let path: MetadataPath
        /// What remains missing after everything honest has been tried —
        /// in practice, a location nobody measured.
        public let evidence: EvidenceCheck
    }

    public static func finish(captured: Data, stamp: CaptureStamp) throws -> Outcome {
        let result = try ExifStamper.stamp(jpeg: captured, with: stamp)
        guard result.imageDataUnchanged else { throw MetadataFinishError.imageDataWouldChange }

        return Outcome(
            data: result.data,
            path: result.filledIn.isEmpty ? .writtenAtCapture : .stampedAfterCapture,
            evidence: EvidenceRequirements.check(jpeg: result.data)
        )
    }
}
