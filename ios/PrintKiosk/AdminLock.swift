import Foundation
import CommonCrypto

/// The staff PIN that guards Configurações (printer, Pix token, subscription).
///
/// - There is no default PIN: the first time Configurações opens, the staff creates one.
/// - Only a salted PBKDF2 hash is kept, in the Keychain of this device.
/// - After 5 wrong tries the gate locks for 1 minute, doubling on each further miss (max 1 hour),
///   and the lock survives closing the app.
enum AdminLock {
    static let minimumLength = 6
    private static let hashKey = "admin.pinHash"
    private static let failuresKey = "admin.pinFailures"
    private static let lockedUntilKey = "admin.pinLockedUntil"
    private static let iterations: UInt32 = 120_000
    private static let freeTries = 5

    static var isSet: Bool { Keychain.get(hashKey) != nil }

    /// Moves a PIN chosen in an older version (kept in plain settings) into the Keychain.
    /// The old factory PIN "1234" is not carried over: the staff must choose a new one.
    static func migrate(legacyPIN: String) {
        guard !isSet, legacyPIN.count >= 4, legacyPIN != "1234", legacyPIN.allSatisfy(\.isNumber) else { return }
        save(legacyPIN)
    }

    static func isAcceptable(_ pin: String) -> Bool {
        pin.count >= minimumLength && pin.count <= 12 && pin.allSatisfy(\.isNumber) && !isTrivial(pin)
    }

    /// Rejects 111111, 123456, 654321 and the like.
    static func isTrivial(_ pin: String) -> Bool {
        let digits = pin.compactMap(\.wholeNumberValue)
        guard digits.count > 1 else { return true }
        let steps = Set(zip(digits, digits.dropFirst()).map { $1 - $0 })
        return steps == [0] || steps == [1] || steps == [-1]
    }

    static func save(_ pin: String) {
        var salt = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, salt.count, &salt)
        let hash = derive(pin, salt: salt)
        Keychain.set("\(Data(salt).base64EncodedString()):\(hash.base64EncodedString())", for: hashKey)
        resetFailures()
    }

    /// Seconds left before another try is allowed, or nil when the gate is open.
    static var lockRemaining: TimeInterval? {
        guard let until = Keychain.get(lockedUntilKey).flatMap(Double.init) else { return nil }
        let remaining = until - Date().timeIntervalSince1970
        return remaining > 0 ? remaining : nil
    }

    enum Result { case ok, wrong(triesLeft: Int), locked(seconds: Int) }

    static func check(_ pin: String) -> Result {
        if let remaining = lockRemaining { return .locked(seconds: Int(remaining.rounded(.up))) }
        guard let stored = Keychain.get(hashKey) else { return .wrong(triesLeft: 0) }
        let parts = stored.split(separator: ":").map(String.init)
        guard parts.count == 2, let salt = Data(base64Encoded: parts[0]), let expected = Data(base64Encoded: parts[1]) else {
            return .wrong(triesLeft: 0)
        }
        if constantTimeEqual(derive(pin, salt: [UInt8](salt)), expected) {
            resetFailures()
            return .ok
        }
        let failures = (Keychain.get(failuresKey).flatMap(Int.init) ?? 0) + 1
        Keychain.set(String(failures), for: failuresKey)
        guard failures >= freeTries else { return .wrong(triesLeft: freeTries - failures) }
        let seconds = min(3600, 60 * (1 << min(failures - freeTries, 6)))
        Keychain.set(String(Date().timeIntervalSince1970 + Double(seconds)), for: lockedUntilKey)
        return .locked(seconds: seconds)
    }

    private static func resetFailures() {
        Keychain.set(nil, for: failuresKey)
        Keychain.set(nil, for: lockedUntilKey)
    }

    private static func derive(_ pin: String, salt: [UInt8]) -> Data {
        var out = [UInt8](repeating: 0, count: 32)
        let password = Array(pin.utf8)
        _ = password.withUnsafeBufferPointer { passwordBuffer in
            CCKeyDerivationPBKDF(
                CCPBKDFAlgorithm(kCCPBKDF2),
                passwordBuffer.baseAddress.map { UnsafeRawPointer($0).assumingMemoryBound(to: Int8.self) },
                password.count,
                salt, salt.count,
                CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                iterations,
                &out, out.count
            )
        }
        return Data(out)
    }

    private static func constantTimeEqual(_ a: Data, _ b: Data) -> Bool {
        guard a.count == b.count else { return false }
        return zip(a, b).reduce(0) { $0 | ($1.0 ^ $1.1) } == 0
    }
}
