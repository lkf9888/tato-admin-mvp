import Foundation

/// The raw hardware identifier, e.g. `iPhone17,1`.
///
/// Only ever a fallback: AVFoundation writes its own, friendlier `Model` into
/// the EXIF and `CaptureMetadata` will not displace it. This is what gets
/// written if some future capture path does not.
enum DeviceIdentity {
    static var machine: String {
        var info = utsname()
        guard uname(&info) == 0 else { return "unknown" }
        // Read through a Mirror rather than by rebinding a pointer into the
        // struct: the pointer form trips Swift's exclusivity checking, and
        // this runs once per session anyway.
        let characters = Mirror(reflecting: info.machine).children
            .compactMap { $0.value as? CChar }
            .prefix { $0 != 0 }
            .map { UInt8(bitPattern: $0) }
        let identifier = String(decoding: characters, as: UTF8.self)
        return identifier.isEmpty ? "unknown" : identifier
    }

    static var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        return "Walkaround \(version) (\(build))"
    }
}
