import Foundation

/// "No 4G/5G" option of "Do celular" (imprime.ai only, not imprime-free).
///
/// The kiosk opens a session on the imprime.ai server and shows its link as a QR Code. The phone
/// uploads there over any internet connection; the kiosk lists the files every 2 seconds, downloads
/// each one and deletes it from the server. Sessions last 30 minutes; closing deletes what is left.
final class RelayClient {
    static let baseURL = URL(string: "https://imprime-ai.vercel.app")!
    static let maxBytes: Int64 = 50 * 1024 * 1024

    struct RemoteFile: Decodable {
        let pathname: String
        let name: String
        let size: Int64
    }

    enum RelayError: Error {
        case sessionGone
        case failed
    }

    let code: String
    let url: String
    private let secret: String
    private let session: URLSession

    private init(code: String, secret: String, url: String) {
        self.code = code
        self.secret = secret
        self.url = url
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 60
        session = URLSession(configuration: configuration)
    }

    /// Opens a session, or returns nil without internet.
    static func open(kioskName: String) async -> RelayClient? {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/relay/session"))
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["kioskName": kioskName])
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let code = json["code"] as? String, !code.isEmpty,
              let secret = json["secret"] as? String, !secret.isEmpty,
              let url = json["url"] as? String, !url.isEmpty
        else { return nil }
        return RelayClient(code: code, secret: secret, url: url)
    }

    private func request(_ method: String, _ suffix: String, pathname: String? = nil) -> URLRequest {
        var components = URLComponents(url: Self.baseURL.appendingPathComponent("api/relay/session/\(code)\(suffix)"),
                                       resolvingAgainstBaseURL: false)!
        if let pathname { components.queryItems = [URLQueryItem(name: "p", value: pathname)] }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        return request
    }

    func list() async throws -> [RemoteFile] {
        let (data, response) = try await session.data(for: request("GET", "/files"))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 404 { throw RelayError.sessionGone }
        guard status == 200 else { throw RelayError.failed }
        struct Listing: Decodable { let files: [RemoteFile] }
        return try JSONDecoder().decode(Listing.self, from: data).files
    }

    /// Saves the file at `target` and returns its content type.
    func download(_ file: RemoteFile, to target: URL) async throws -> String {
        guard file.size <= Self.maxBytes else { throw RelayError.failed }
        let (temporary, response) = try await session.download(for: request("GET", "/file", pathname: file.pathname))
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            try? FileManager.default.removeItem(at: temporary)
            throw RelayError.failed
        }
        try? FileManager.default.removeItem(at: target)
        try FileManager.default.moveItem(at: temporary, to: target)
        return http.value(forHTTPHeaderField: "Content-Type") ?? ""
    }

    func delete(_ file: RemoteFile) async {
        _ = try? await session.data(for: request("DELETE", "/file", pathname: file.pathname))
    }

    func close() async {
        _ = try? await session.data(for: request("DELETE", ""))
    }
}
