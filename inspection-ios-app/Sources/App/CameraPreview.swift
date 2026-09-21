import ARKit
import SceneKit
import SwiftUI

/// The live camera feed, which is now ARKit's.
///
/// ⚠️ Not an `AVCaptureVideoPreviewLayer` any more, and it cannot be: with
/// tracking running there is no capture session to attach one to. `ARSCNView`
/// draws the session's camera feed as its background, which is the same
/// frames the photographs are cut from — so what is on screen is still what
/// lands in the file.
///
/// Nothing is rendered into the scene. This is a viewfinder that happens to
/// be a renderer, not an AR experience: no lighting, no content, no gestures.
/// The coverage diagram deliberately stays a flat drawing over the top rather
/// than becoming geometry in the world, because a photographer needs to see
/// the whole car at once and the car is the thing they are standing next to.
struct CameraPreview: UIViewRepresentable {
    let session: ARSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        // Assigned, never run or paused here. The session's lifecycle belongs
        // to `CoverageTracker`; a view that also started and stopped it would
        // be a second opinion about who owns the camera, which is the whole
        // problem this replaced.
        view.session = session
        view.scene = SCNScene()
        view.automaticallyUpdatesLighting = false
        view.rendersCameraGrain = false
        view.isUserInteractionEnabled = false
        view.backgroundColor = .black
        // The feed is 60fps; the viewfinder does not need to be, and the
        // photographer is holding a phone that is also running world tracking
        // and scene reconstruction.
        view.preferredFramesPerSecond = 30
        return view
    }

    func updateUIView(_ view: ARSCNView, context: Context) {}
}
