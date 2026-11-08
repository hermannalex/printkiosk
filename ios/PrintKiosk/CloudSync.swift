import Foundation
import UIKit
import CryptoKit

/// One finished print, as reported to the online dashboard.
struct PrintJobRecord: Codable, Equatable {
    var id: String
    var printedAt: String
    var items: Int
    var pages: Int
    var copies: Int
    var totalPages: Int
    var amountCents: Int
    var paidWithPix: Bool
    var pixPaymentId: String?
    var success: Bool
    var demo: Bool
}

/// The settings the dashboard can change (web/lib/kiosk-config.ts); every key is optional.
struct RemoteConfig: Codable {
    var kioskName: String?
    var pricePerPageCents: Int?
    var maxCopies: Int?
    var maxItems: Int?
    var idleTimeoutSeconds: Int?
    var paymentTimeoutSeconds: Int?
    var payerEmail: String?
    var wifiName: String?
    var wifiPassword: String?
}

struct SyncResponse: Decodable {
    var accepted: [String]?
    var activationCode: String?
    var validUntil: String?
    var plan: String?
    var dashboardUrl: String?
    /// Settings saved in the dashboard, applied when `configVersion` is newer than the last one applied.
    var config: RemoteConfig?
    var configVersion: Int?
    var error: String?
}

/// Talks to the PrintKiosk dashboard: sends the print history and picks up the month's
/// activation code, so a paid subscription reaches the kiosk without anyone typing it.
/// Prints are queued on the device and sent whenever there is internet.
@MainActor
final class CloudSync {
    static let serverURL = URL(string: "https://quioco.vercel.app")!

    private static let secretKey = "sync.secret"
    private static let queueKey = "sync.queue"
    private static let lastSyncKey = "sync.lastSync"
    private static let dashboardKey = "sync.dashboardURL"

    private var isSyncing = false

    /// Random per-device secret; the server binds the store code to it on first contact.
    private var secret: String {
        if let saved = Keychain.get(Self.secretKey), saved.count >= 16 { return saved }
        let bytes = (0..<24).map { _ in UInt8.random(in: 0...255) }
        let value = Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        Keychain.set(value, for: Self.secretKey)
        return value
    }

    /// Proves to the dashboard that whoever adds this kiosk has its Configurações open.
    /// Same derivation as web/lib/license.ts `pairingCode`: base32(sha256("pair:" + sha256hex(secret))), 6 chars.
    var pairingCode: String {
        let secretHash = SHA256.hash(data: Data(secret.utf8)).map { String(format: "%02x", $0) }.joined()
        let digest = Array(SHA256.hash(data: Data("pair:\(secretHash)".utf8)))
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var bits: UInt64 = 0
        for byte in digest.prefix(5) { bits = (bits << 8) | UInt64(byte) }
        let chars = (0..<8).reversed().map { alphabet[Int((bits >> UInt64($0 * 5)) & 31)] }.prefix(6)
        let text = String(chars)
        return String(text.prefix(3)) + "-" + String(text.suffix(3))
    }

    private(set) var queue: [PrintJobRecord] {
        get {
            guard let data = UserDefaults.standard.data(forKey: Self.queueKey) else { return [] }
            return (try? JSONDecoder().decode([PrintJobRecord].self, from: data)) ?? []
        }
        set {
            let trimmed = Array(newValue.suffix(2000))
            UserDefaults.standard.set(try? JSONEncoder().encode(trimmed), forKey: Self.queueKey)
        }
    }

    var lastSync: Date? {
        UserDefaults.standard.object(forKey: Self.lastSyncKey) as? Date
    }

    var dashboardURL: URL {
        UserDefaults.standard.string(forKey: Self.dashboardKey).flatMap(URL.init(string:)) ?? Self.serverURL
    }

    func record(_ job: PrintJobRecord) {
        queue.append(job)
    }

    /// Sends queued prints and returns the server's answer, or nil when offline.
    func sync(storeCode: String, license: LicenseState, config: RemoteConfig, configVersion: Int) async -> SyncResponse? {
        guard !isSyncing else { return nil }
        isSyncing = true
        defer { isSyncing = false }

        let pending = Array(queue.prefix(200))
        let (licenseState, demoRemaining): (String, Int?) = {
            switch license {
            case .active: return ("active", nil)
            case .expired: return ("expired", nil)
            case .demo(let remaining): return ("demo", remaining)
            case .demoOver: return ("demoOver", 0)
            }
        }()

        let body: [String: Any?] = [
            "storeCode": storeCode,
            "secret": secret,
            "platform": UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone",
            "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
            "licenseState": licenseState,
            "demoRemaining": demoRemaining,
            "config": (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(config))) as Any?,
            "configVersion": configVersion,
            "jobs": pending.map { job -> [String: Any?] in
                [
                    "id": job.id, "printedAt": job.printedAt, "items": job.items, "pages": job.pages,
                    "copies": job.copies, "totalPages": job.totalPages, "amountCents": job.amountCents,
                    "paidWithPix": job.paidWithPix, "pixPaymentId": job.pixPaymentId,
                    "success": job.success, "demo": job.demo,
                ]
            },
        ]

        var request = URLRequest(url: Self.serverURL.appendingPathComponent("api/kiosk/sync"))
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body.compactMapValues { $0 })

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse,
              let decoded = try? JSONDecoder().decode(SyncResponse.self, from: data)
        else { return nil }

        guard http.statusCode == 200 else { return decoded }

        // The server stores each job once (by id), so the whole batch is done; anything it
        // skipped had a malformed date and would never be accepted.
        let sentIDs = Set(pending.map(\.id))
        queue = queue.filter { !sentIDs.contains($0.id) }
        UserDefaults.standard.set(Date(), forKey: Self.lastSyncKey)
        if let url = decoded.dashboardUrl, !url.isEmpty {
            UserDefaults.standard.set(url, forKey: Self.dashboardKey)
        }
        return decoded
    }

    static func isoNow() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}
