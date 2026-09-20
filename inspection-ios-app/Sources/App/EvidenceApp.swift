import SwiftUI

@main
struct EvidenceApp: App {
    @State private var settings = ServerSettings()

    var body: some Scene {
        WindowGroup {
            // Straight into the camera. There is no home screen, because a
            // home screen is a page whose only job is to be got past.
            CaptureView()
                .environment(settings)
                .preferredColorScheme(.dark)
        }
    }
}
