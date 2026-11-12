import Foundation
import CryptoKit

/// Subscription, free trial, or the free version. The kiosk always prints; after the 10 free
/// prints (or when the subscription lapses) every page carries the "imprime.ai" watermark.
enum LicenseState: Equatable {
    case active(until: Date)
    case demo(remaining: Int)
    case expired(on: Date)
    case demoOver

    var canPrint: Bool { true }

    var watermarked: Bool {
        switch self {
        case .active, .demo: return false
        case .expired, .demoOver: return true
        }
    }
}

/// Monthly activation codes. A code is `PK1-` + base64url(payload + ECDSA signature), where
/// payload = version (1 byte) + store ID (5 bytes) + last valid day (2 bytes, days since 2024-01-01).
/// Codes are made with tools/gerar-codigo.py and the private key, which never ships in the app.
enum License {
    static let demoPrints = 10
    static let priceLabel = "a partir de R$ 19,99/mês"
    static let vendorContact = "alex@somainfo.com.br"

    /// Public half of the signing key (X.509 SubjectPublicKeyInfo, P-256).
    private static let publicKey =
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvKAdZ2rVE+ExL+GWj0OJcDS05O4NnOBt8hAXeUANqC/aX1J2RW9cpXoDr78Xag57U0tm1Vo2oO90bSO95fiYYw=="

    private static let storeIDKey = "license.storeID"
    private static let codeKey = "license.code"
    private static let demoUsedKey = "license.demoUsed"
    private static let maxDayKey = "license.maxDay"

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }

    private static var epoch: Date {
        calendar.date(from: DateComponents(year: 2024, month: 1, day: 1))!
    }

    // MARK: Store ID

    /// Five random bytes made on first launch. Kept in the Keychain, so it survives reinstalls.
    static var storeID: Data {
        if let saved = Keychain.get(storeIDKey).flatMap({ Data(base64Encoded: $0) }), saved.count == 5 {
            return saved
        }
        var bytes = [UInt8](repeating: 0, count: 5)
        for index in bytes.indices { bytes[index] = UInt8.random(in: 0...255) }
        let data = Data(bytes)
        Keychain.set(data.base64EncodedString(), for: storeIDKey)
        return data
    }

    /// "ABCD-EFGH" for the 5-byte store ID.
    static func storeCode(_ id: Data) -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var bits: UInt64 = 0
        for byte in id { bits = (bits << 8) | UInt64(byte) }
        let characters = (0..<8).reversed().map { alphabet[Int((bits >> UInt64($0 * 5)) & 31)] }
        let text = String(characters)
        return String(text.prefix(4)) + "-" + String(text.suffix(4))
    }

    // MARK: Dates

    static func dayNumber(_ date: Date) -> Int {
        calendar.dateComponents([.day], from: epoch, to: calendar.startOfDay(for: date)).day ?? 0
    }

    static func date(dayNumber: Int) -> Date {
        calendar.date(byAdding: .day, value: dayNumber, to: epoch)!
    }

    /// Today as a day number, never earlier than a day already seen (so turning the clock back doesn't help).
    private static func today() -> Int {
        let real = dayNumber(Date())
        let seen = Keychain.get(maxDayKey).flatMap(Int.init) ?? real
        let effective = max(real, seen)
        Keychain.set(String(effective), for: maxDayKey)
        return effective
    }

    // MARK: Codes

    /// Returns the last valid day number, or nil when the code is not valid for this store.
    static func verify(code: String, storeID: Data) -> Int? {
        var text = code.filter { !$0.isWhitespace }
        if text.uppercased().hasPrefix("PK1-") { text = String(text.dropFirst(4)) }
        text = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while text.count % 4 != 0 { text += "=" }

        guard let data = Data(base64Encoded: text), data.count > 8 else { return nil }
        let payload = data.prefix(8)
        let signature = data.dropFirst(8)
        let bytes = [UInt8](payload)
        guard bytes[0] == 1, Data(bytes[1..<6]) == storeID else { return nil }

        guard let keyData = Data(base64Encoded: publicKey),
              let key = try? P256.Signing.PublicKey(derRepresentation: keyData),
              let ecdsa = try? P256.Signing.ECDSASignature(derRepresentation: signature),
              key.isValidSignature(ecdsa, for: Data(payload))
        else { return nil }

        return (Int(bytes[6]) << 8) | Int(bytes[7])
    }

    // MARK: State

    static func state() -> LicenseState {
        if let code = Keychain.get(codeKey), let until = verify(code: code, storeID: storeID) {
            return today() <= until
                ? .active(until: date(dayNumber: until))
                : .expired(on: date(dayNumber: until))
        }
        let used = Keychain.get(demoUsedKey).flatMap(Int.init) ?? 0
        let remaining = demoPrints - used
        return remaining > 0 ? .demo(remaining: remaining) : .demoOver
    }

    /// Saves the code if it is valid for this store and returns its last valid day, or nil.
    static func activate(code: String) -> Int? {
        guard let until = verify(code: code, storeID: storeID) else { return nil }
        Keychain.set(code.filter { !$0.isWhitespace }, for: codeKey)
        return until
    }

    static func recordDemoPrint() {
        let used = Keychain.get(demoUsedKey).flatMap(Int.init) ?? 0
        Keychain.set(String(used + 1), for: demoUsedKey)
    }
}
