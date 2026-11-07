import Foundation
import Security

/// Minimal Keychain wrapper for the Mercado Pago access token.
/// The token never goes into UserDefaults or backups, and stays on this device only.
enum Keychain {
    private static let service = "PrintKiosk"

    private static func baseQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
    }

    /// Saves the value, or deletes it when `value` is nil or empty.
    static func set(_ value: String?, for key: String) {
        let query = baseQuery(for: key)
        SecItemDelete(query as CFDictionary)

        guard let value, !value.isEmpty else { return }
        var item = query
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

enum Money {
    private static let formatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale(identifier: "pt_BR")
        return formatter
    }()

    static func format(cents: Int) -> String {
        formatter.string(from: NSDecimalNumber(value: cents).dividing(by: 100)) ?? "R$ \(cents / 100)"
    }
}
