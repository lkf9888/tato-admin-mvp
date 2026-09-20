import SwiftUI

@main
struct EvidenceApp: App {
    @State private var settings = ServerSettings()

    var body: some Scene {
        WindowGroup {
            ShotPlanView()
                .environment(settings)
        }
    }
}
