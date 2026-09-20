import Foundation
import CryptoKit

/// The digest that turns "this photo has plausible metadata" into "this photo
/// is the file the camera produced".
///
/// **Order matters and the order is fixed:** metadata first, hash second,
/// upload third, and never a byte changed afterwards. A hash taken before
/// `ExifStamper` runs describes a file that no longer exists, which quietly
/// invalidates the entire chain — the archived digest would disagree with the
/// archived file and an opponent would be right to say so.
public enum EvidenceHash {
    public static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    public static func matches(_ data: Data, digest: String) -> Bool {
        sha256(data).caseInsensitiveCompare(digest) == .orderedSame
    }
}
