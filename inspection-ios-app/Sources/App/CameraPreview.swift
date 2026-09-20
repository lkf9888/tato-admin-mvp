import AVFoundation
import SwiftUI

/// The live camera feed, filling whatever it is given.
///
/// Tapping it focuses and meters there, the way the iPhone camera does. The
/// tap is reported twice over: once in the capture device's own normalised
/// coordinates, which is what AVFoundation wants, and once in the view's
/// points, which is where the yellow square has to be drawn. Only the
/// preview layer knows how to get from one to the other, so the conversion
/// happens here rather than in the view that draws the square.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    /// `(devicePoint, viewPoint)`.
    var onFocusTap: ((CGPoint, CGPoint) -> Void)?

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        context.coordinator.view = view

        let tap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleTap(_:))
        )
        view.addGestureRecognizer(tap)
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {
        context.coordinator.onFocusTap = onFocusTap
    }

    @MainActor
    final class Coordinator: NSObject {
        weak var view: PreviewView?
        var onFocusTap: ((CGPoint, CGPoint) -> Void)?

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard let view, let onFocusTap else { return }
            let point = recognizer.location(in: view)
            let devicePoint = view.previewLayer.captureDevicePointConverted(fromLayerPoint: point)
            onFocusTap(devicePoint, point)
        }
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
