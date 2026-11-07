import Foundation

/// A Pix charge created on Mercado Pago.
struct PixCharge: Equatable {
    let id: Int64
    /// The "Pix copia e cola" payload, rendered as a QR Code on screen.
    let qrCode: String
    let amountCents: Int
}

enum PixError: LocalizedError {
    case unauthorized
    case api(String)
    case invalidResponse
    case network

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "O Mercado Pago recusou o token de acesso. Confira o token nas configurações."
        case .api(let message):
            return "O Mercado Pago recusou a cobrança: \(message)"
        case .invalidResponse:
            return "O Mercado Pago enviou uma resposta inesperada. Tente de novo."
        case .network:
            return "Sem conexão com o Mercado Pago. Verifique a internet do iPad e tente de novo."
        }
    }
}

/// Talks to the Mercado Pago Payments API to create Pix charges and check their status.
/// Docs: https://www.mercadopago.com.br/developers/pt/docs (Checkout Transparente › Pix)
struct PixService {
    enum Status: String {
        case pending
        case approved
        case authorized
        case inProcess = "in_process"
        case inMediation = "in_mediation"
        case rejected
        case cancelled
        case refunded
        case chargedBack = "charged_back"
        case unknown

        var isFinalFailure: Bool {
            [.rejected, .cancelled, .refunded, .chargedBack].contains(self)
        }
    }

    let accessToken: String

    private static let baseURL = URL(string: "https://api.mercadopago.com/")!

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        return URLSession(configuration: configuration)
    }()

    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = .current
        return formatter
    }()

    /// Creates a Pix charge. Mercado Pago requires an expiration of at least 30 minutes;
    /// the kiosk cancels the charge itself much sooner if nobody pays.
    func createCharge(amountCents: Int, description: String, payerEmail: String) async throws -> PixCharge {
        let body: [String: Any] = [
            "transaction_amount": NSDecimalNumber(value: amountCents).dividing(by: 100),
            "description": description,
            "payment_method_id": "pix",
            "payer": ["email": payerEmail],
            "date_of_expiration": Self.isoFormatter.string(from: Date().addingTimeInterval(30 * 60))
        ]

        let json = try await send(
            path: "v1/payments",
            method: "POST",
            body: body,
            idempotencyKey: UUID().uuidString
        )

        guard let id = (json["id"] as? NSNumber)?.int64Value,
              let interaction = json["point_of_interaction"] as? [String: Any],
              let transaction = interaction["transaction_data"] as? [String: Any],
              let qrCode = transaction["qr_code"] as? String
        else { throw PixError.invalidResponse }

        return PixCharge(id: id, qrCode: qrCode, amountCents: amountCents)
    }

    func status(of paymentID: Int64) async throws -> Status {
        let json = try await send(path: "v1/payments/\(paymentID)", method: "GET")
        return Status(rawValue: json["status"] as? String ?? "") ?? .unknown
    }

    /// Cancels a charge that hasn't been paid yet, so the QR Code stops working.
    func cancel(_ paymentID: Int64) async throws {
        _ = try await send(path: "v1/payments/\(paymentID)", method: "PUT", body: ["status": "cancelled"])
    }

    /// Used by "Testar conexão" in staff settings.
    func accountName() async throws -> String {
        let json = try await send(path: "users/me", method: "GET")
        return (json["nickname"] as? String) ?? (json["email"] as? String) ?? "conta Mercado Pago"
    }

    // MARK: - HTTP

    private func send(
        path: String,
        method: String,
        body: [String: Any]? = nil,
        idempotencyKey: String? = nil
    ) async throws -> [String: Any] {
        var request = URLRequest(url: Self.baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "X-Idempotency-Key")
        }
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await Self.session.data(for: request)
        } catch {
            throw PixError.network
        }

        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0

        switch statusCode {
        case 200..<300:
            return json
        case 401, 403:
            throw PixError.unauthorized
        default:
            throw PixError.api(json["message"] as? String ?? "erro HTTP \(statusCode)")
        }
    }
}
