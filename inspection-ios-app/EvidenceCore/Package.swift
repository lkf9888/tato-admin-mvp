// swift-tools-version: 6.0
import PackageDescription

// EvidenceCore is deliberately free of ARKit and AVFoundation so it also
// builds for macOS. That is not a portability wish: it is what lets the
// evidence-chain rules be tested on a laptop in a second, instead of only
// on a phone in a parking lot.
let package = Package(
    name: "EvidenceCore",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [
        .library(name: "EvidenceCore", targets: ["EvidenceCore"]),
    ],
    targets: [
        .target(name: "EvidenceCore"),
        .testTarget(name: "EvidenceCoreTests", dependencies: ["EvidenceCore"]),
    ]
)
