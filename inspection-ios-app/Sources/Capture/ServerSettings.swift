import Foundation
import Security

/// Where the archive gets sent, and the credential for sending it.
///
/// The address is a setting rather than a constant because this app is meant
/// to be sellable: another Turo host who buys it has no `tatocar.co` to talk
/// to, and hard-wiring one would make the first thing they do be editing
/// source. It also means a session can be pointed at a staging server without
/// a separate build.
@MainActor
@Observable
final class ServerSettings {

    private enum Key {
        static let baseURL = "co.tatocar.evidence.baseURL"
        static let staffCode = "co.tatocar.evidence.staffCode"
        static let token = "co.tatocar.evidence.token"
        static let photographer = "co.tatocar.evidence.photographer"
    }

    var baseURL: String {
        didSet { UserDefaults.standard.set(baseURL, forKey: Key.baseURL) }
    }

    /// The code staff already use for the scheduling app. Stored so nobody has
    /// to re-enter it in a car park with cold hands.
    var staffCode: String {
        didSet { UserDefaults.standard.set(staffCode, forKey: Key.staffCode) }
    }

    /// Remembered so the finish screen comes pre-filled: the same person
    /// photographs the same fleet all week.
    var photographer: String {
        didSet { UserDefaults.standard.set(photographer, forKey: Key.photographer) }
    }

    /// The session token. In the keychain rather than `UserDefaults` because
    /// it is a credential: a device backup of user defaults is readable, and
    /// this one grants access to a fleet's records.
    var token: String? {
        didSet {
            if let token { Keychain.set(token, for: Key.token) } else { Keychain.remove(Key.token) }
        }
    }

    var isSignedIn: Bool { token?.isEmpty == false }

    init() {
        baseURL = UserDefaults.standard.string(forKey: Key.baseURL) ?? "https://tatocar.co"
        staffCode = UserDefaults.standard.string(forKey: Key.staffCode) ?? ""
        photographer = UserDefaults.standard.string(forKey: Key.photographer) ?? ""
        token = Keychain.get(Key.token)
    }

    var endpoint: URL? {
        URL(string: baseURL.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "/+$", with: "", options: .regularExpression))
    }
}

enum Keychain {
    static func set(_ value: String, for key: String) {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: key,
        ]
        SecItemDelete(query as CFDictionary)

        var attributes = query
        attributes[kSecValueData] = Data(value.utf8)
        // The token is only needed while somebody is using the phone, and a
        // locked phone that has not been unlocked since boot should not be
        // handing out fleet credentials.
        attributes[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(attributes as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: key,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func remove(_ key: String) {
        SecItemDelete([
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: key,
        ] as CFDictionary)
    }
}
