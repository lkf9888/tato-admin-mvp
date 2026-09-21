import ARKit
import AVFoundation
import CoreVideo
import EvidenceCore
import Foundation
import VideoToolbox

enum ARCameraError: LocalizedError {
    case captureFailed(String)
    case frameUnreadable

    var errorDescription: String? {
        switch self {
        case .captureFailed:
            return "这一张没有拍成，再按一次快门。"
        case .frameUnreadable:
            return "相机给回来的画面读不出来，再按一次快门。"
        }
    }

    /// The untranslated reason, for the diagnostics line rather than for the
    /// person holding the phone.
    var detail: String {
        switch self {
        case .captureFailed(let reason): return reason
        case .frameUnreadable: return "pixel buffer would not convert"
        }
    }
}

/// One photograph, and how big it turned out to be.
///
/// The size travels with the data rather than being stashed on the camera,
/// because the capture completes on ARKit's delegate queue and reading a
/// property written there from the main actor is exactly the kind of race
/// that shows up once a month and is never reproducible.
struct ARCapture: Sendable {
    let data: Data
    let pixelWidth: Int
    let pixelHeight: Int
}

/// Takes the photographs through ARKit, because nothing else may hold the
/// camera while tracking is running.
///
/// ## Why not `AVCapturePhotoOutput`
///
/// It was, until a walk-around proved the two cannot coexist: with tracking
/// live the capture session is interrupted, and with the capture session live
/// tracking never starts. There is no ordering that gets both — an earlier
/// reading that said otherwise was taken with the settings sheet covering the
/// viewfinder, so the frozen preview underneath went unseen.
///
/// So ARKit owns the camera outright. The viewfinder is its video feed and
/// the photographs come from `captureHighResolutionFrame`, which hands back
/// the camera's processed pixels at still resolution together with its EXIF.
/// `PhotoEncoder` makes the file; what that costs is written down there.
///
/// `@unchecked Sendable` because everything it touches is either immutable or
/// confined to the completion handler it arrives on.
final class ARCamera: @unchecked Sendable {

    private let session: ARSession

    init(session: ARSession) {
        self.session = session
    }

    /// Takes one photograph.
    ///
    /// The conversion and the JPEG encode both happen inside ARKit's
    /// completion handler, off the main actor. That is deliberate: encoding
    /// a twelve-megapixel frame takes long enough to drop preview frames,
    /// and passing a `CGImage` and a metadata dictionary across an isolation
    /// boundary to avoid it would be more ceremony than the work.
    func capturePhoto(stamp: CaptureStamp) async throws -> ARCapture {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<ARCapture, Error>) in
            session.captureHighResolutionFrame { frame, error in
                guard let frame else {
                    let reason = error?.localizedDescription ?? "no frame and no error"
                    continuation.resume(throwing: ARCameraError.captureFailed(reason))
                    return
                }
                do {
                    continuation.resume(returning: try Self.encode(frame: frame, stamp: stamp))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private static func encode(frame: ARFrame, stamp: CaptureStamp) throws -> ARCapture {
        let buffer = frame.capturedImage

        // VideoToolbox rather than CoreImage: the buffer arrives as biplanar
        // YCbCr and this is the one conversion that does not drag a whole
        // rendering context in behind it.
        var image: CGImage?
        VTCreateCGImageFromCVPixelBuffer(buffer, options: nil, imageOut: &image)
        guard let image else { throw ARCameraError.frameUnreadable }

        let data = try PhotoEncoder.encode(
            image: image,
            cameraProperties: frame.exifData as? [String: Any] ?? [:],
            stamp: stamp
        )
        return ARCapture(
            data: data,
            pixelWidth: CVPixelBufferGetWidth(buffer),
            pixelHeight: CVPixelBufferGetHeight(buffer)
        )
    }

    // MARK: - The lamp

    /// Still reachable, even though nothing here owns a capture session.
    ///
    /// The torch belongs to the `AVCaptureDevice`, not to whoever is
    /// streaming from it, so it can be locked and switched while ARKit has
    /// the camera. Returns what actually happened rather than what was asked
    /// for: the hardware refuses when the phone is hot.
    @discardableResult
    func setTorch(_ on: Bool) -> Bool {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              device.hasTorch,
              (try? device.lockForConfiguration()) != nil
        else { return false }
        defer { device.unlockForConfiguration() }

        if on, device.isTorchAvailable {
            try? device.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel)
        } else {
            device.torchMode = .off
        }
        return device.torchMode == .on
    }
}
