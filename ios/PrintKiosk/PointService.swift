import Foundation

/// Mercado Pago Point (Point Smart 1/2, Point Pro 2) through the Orders API: the kiosk sends the
/// amount to the store's card terminal and the customer pays there with a chip card, a contactless
/// card, Apple Pay or Google Pay. The terminal must be in PDV mode (set from Configurações).
struct PointService {
    enum Status { case pending, approved, failed }

    struct Terminal: Identifiable, Equatable {
        let id: String
        let operatingMode: String
    }

    let accessToken: String
    private static let baseURL = URL(string: "https://api.mercadopago.com/")!

    func terminals() async throws -> [Terminal] {
        let json = try await send(path: "terminals/v1/list", query: "limit=50", method: "GET")
        let list = ((json["data"] as? [String: Any])?["terminals"] as? [[String: Any]] ?? []).compactMap { t -> Terminal? in
            guard let id = t["id"] as? String, !id.isEmpty else { return nil }
            return Terminal(id: id, operatingMode: t["operating_mode"] as? String ?? "")
        }
        if list.isEmpty {
            throw PixError.api("nenhuma maquininha Point nesta conta. Vincule a Point no app do Mercado Pago e tente de novo.")
        }
        return list
    }

    /// Puts the terminal in the mode where it waits for amounts sent by a system.
    func setPDVMode(_ terminalID: String) async throws {
        _ = try await send(path: "terminals/v1/setup", method: "PATCH",
                           body: ["terminals": [["id": terminalID, "operating_mode": "PDV"]]])
    }

    /// Sends the amount to the terminal; returns the order id.
    func createOrder(terminalID: String, amountCents: Int, seconds: Int, description: String) async throws -> String {
        let duration = seconds % 60 == 0 ? "PT\(seconds / 60)M" : "PT\(max(30, seconds))S"
        let reference = "quioco-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(20)
        let body: [String: Any] = [
            "type": "point",
            "external_reference": String(reference),
            "expiration_time": duration,
            "description": String(description.prefix(150)),
            "transactions": ["payments": [["amount": String(format: "%d.%02d", amountCents / 100, amountCents % 100)]]],
            "config": ["point": ["terminal_id": terminalID, "print_on_terminal": "no_ticket"]],
        ]
        let json = try await send(path: "v1/orders", method: "POST", body: body,
                                  headers: ["X-Idempotency-Key": UUID().uuidString])
        guard let id = json["id"] as? String, !id.isEmpty else { throw PixError.invalidResponse }
        return id
    }

    func status(of orderID: String) async throws -> Status {
        Self.map(try await send(path: "v1/orders/\(orderID)", method: "GET"))
    }

    /// Cancels the order on the terminal; returns .approved if it was paid meanwhile.
    func cancel(_ orderID: String) async -> Status {
        let result = try? await send(path: "v1/orders/\(orderID)/cancel", method: "POST", body: [:],
                                     headers: ["X-Idempotency-Key": UUID().uuidString,
                                               "x-allow-cancelable-status": "at_terminal"])
        if let result, Self.map(result) == .approved { return .approved }
        return (try? await status(of: orderID)) == .approved ? .approved : .failed
    }

    private static func map(_ order: [String: Any]) -> Status {
        switch order["status"] as? String {
        case "processed": return .approved
        case "failed", "canceled", "expired", "refunded": return .failed
        default: return .pending // created, at_terminal, action_required
        }
    }

    private func send(path: String, query: String? = nil, method: String, body: [String: Any]? = nil,
                      headers: [String: String] = [:]) async throws -> [String: Any] {
        var url = Self.baseURL.appendingPathComponent(path)
        if let query, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            parts.percentEncodedQuery = query
            url = parts.url ?? url
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw PixError.network
        }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            if code == 401 { throw PixError.unauthorized }
            let message = (json["message"] as? String)
                ?? ((json["errors"] as? [[String: Any]])?.first?["message"] as? String)
                ?? "erro HTTP \(code)"
            throw PixError.api(message)
        }
        return json
    }
}
