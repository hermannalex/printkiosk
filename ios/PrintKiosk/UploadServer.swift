import Foundation
import Network

struct UploadResult {
    let ok: Bool
    let message: String
}

/// A tiny web server on the store's Wi-Fi. The customer's phone opens the upload page from the
/// QR Code and sends each file as the raw body of a POST. Only the address with this session's
/// random token works, and the server only runs while the "Do celular" panel is open.
final class UploadServer {
    typealias FileHandler = (_ file: URL, _ name: String, _ mimeType: String,
                             _ completion: @escaping (UploadResult) -> Void) -> Void

    static let maxBytes = 50 * 1024 * 1024

    let token: String
    let page: String
    let directory: URL
    let handler: FileHandler
    let queue = DispatchQueue(label: "br.com.somainfo.PrintKiosk.upload")

    private var listener: NWListener?

    init(token: String, page: String, directory: URL, handler: @escaping FileHandler) {
        self.token = token
        self.page = page
        self.directory = directory
        self.handler = handler
    }

    /// Starts listening on a free port. `completion` runs on the main queue with the port, or nil.
    func start(completion: @escaping (UInt16?) -> Void) {
        guard let listener = try? NWListener(using: .tcp) else {
            completion(nil)
            return
        }
        self.listener = listener

        let reported = Flag()
        listener.stateUpdateHandler = { [weak listener] state in
            switch state {
            case .ready:
                guard !reported.value else { return }
                reported.value = true
                let port = listener?.port?.rawValue
                DispatchQueue.main.async { completion(port) }
            case .failed, .cancelled:
                guard !reported.value else { return }
                reported.value = true
                DispatchQueue.main.async { completion(nil) }
            default:
                break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else {
                connection.cancel()
                return
            }
            UploadSession(connection: connection, server: self).start()
        }
        listener.start(queue: queue)
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    /// This device's IPv4 address on the local network, preferring Wi-Fi (en0).
    static func localIPAddress() -> String? {
        var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0, let first = interfaces else { return nil }
        defer { freeifaddrs(interfaces) }

        var fallback: String?
        for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let interface = pointer.pointee
            guard let address = interface.ifa_addr, address.pointee.sa_family == UInt8(AF_INET) else { continue }
            let flags = Int32(interface.ifa_flags)
            guard flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else { continue }

            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count),
                              nil, 0, NI_NUMERICHOST) == 0 else { continue }
            let ip = String(cString: host)
            let name = String(cString: interface.ifa_name)
            if name == "en0" { return ip }
            if name.hasPrefix("en"), fallback == nil { fallback = ip }
        }
        return fallback
    }
}

private final class Flag {
    var value = false
}

/// One HTTP request from a phone. Lives until the response is sent.
private final class UploadSession {
    private let connection: NWConnection
    private let server: UploadServer

    private var buffer = Data()
    private var headerParsed = false
    private var finished = false

    private var fileHandle: FileHandle?
    private var fileURL: URL?
    private var fileName = ""
    private var mimeType = ""
    private var expected = 0
    private var written = 0

    init(connection: NWConnection, server: UploadServer) {
        self.connection = connection
        self.server = server
    }

    func start() {
        connection.start(queue: server.queue)
        receive()
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [self] data, _, isComplete, error in
            if let data, !data.isEmpty { consume(data) }
            if finished { return }
            if error != nil || isComplete {
                abort()
                return
            }
            receive()
        }
    }

    private func consume(_ data: Data) {
        if headerParsed {
            writeBody(data)
            return
        }
        buffer.append(data)
        guard let end = buffer.range(of: Data([13, 10, 13, 10])) else {
            if buffer.count > 16_384 { respond(status: 400, body: "Bad request") }
            return
        }
        let head = String(decoding: buffer[buffer.startIndex..<end.lowerBound], as: UTF8.self)
        let rest = Data(buffer[end.upperBound...])
        buffer = Data()
        headerParsed = true
        route(head: head, rest: rest)
    }

    private func route(head: String, rest: Data) {
        let lines = head.components(separatedBy: "\r\n")
        let requestLine = (lines.first ?? "").split(separator: " ")
        guard requestLine.count >= 2 else {
            respond(status: 400, body: "Bad request")
            return
        }
        let method = String(requestLine[0])
        let target = String(requestLine[1])

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            headers[key] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }

        let components = URLComponents(string: "http://kiosk" + target)
        let path = components?.path ?? ""
        let base = "/u/\(server.token)"

        if method == "GET", path == base || path == base + "/" {
            respond(status: 200, contentType: "text/html; charset=utf-8", body: server.page)
        } else if method == "POST", path == base + "/upload" {
            let name = components?.queryItems?.first(where: { $0.name == "name" })?.value
            beginUpload(headers: headers, name: name, rest: rest)
        } else {
            respond(status: 404, contentType: "text/html; charset=utf-8", body: Self.expiredPage)
        }
    }

    private func beginUpload(headers: [String: String], name: String?, rest: Data) {
        guard let length = headers["content-length"].flatMap({ Int($0) }), length > 0 else {
            respondJSON(status: 411, UploadResult(ok: false, message: "Envio inválido. Tente de novo."))
            return
        }
        guard length <= UploadServer.maxBytes else {
            respondJSON(status: 413, UploadResult(ok: false, message: "Arquivo grande demais. O limite é 50 MB."))
            return
        }

        let cleanName = String((name ?? "").prefix(120))
        fileName = cleanName.isEmpty ? "arquivo" : cleanName
        mimeType = (headers["content-type"] ?? "")
            .components(separatedBy: ";")[0]
            .trimmingCharacters(in: .whitespaces)
            .lowercased()

        let fileExtension = String((fileName as NSString).pathExtension.lowercased()
            .filter { $0.isLetter || $0.isNumber }
            .prefix(5))
        let url = server.directory.appendingPathComponent(
            UUID().uuidString + "." + (fileExtension.isEmpty ? "bin" : fileExtension)
        )
        try? FileManager.default.createDirectory(at: server.directory, withIntermediateDirectories: true)
        guard FileManager.default.createFile(atPath: url.path, contents: nil),
              let handle = try? FileHandle(forWritingTo: url) else {
            respondJSON(status: 500, UploadResult(ok: false, message: "O quiosque não conseguiu salvar o arquivo."))
            return
        }

        fileURL = url
        fileHandle = handle
        expected = length
        if !rest.isEmpty { writeBody(rest) }
    }

    private func writeBody(_ data: Data) {
        guard let handle = fileHandle, let url = fileURL, written < expected else { return }
        let part = data.prefix(expected - written)
        handle.write(part)
        written += part.count
        guard written >= expected else { return }

        try? handle.close()
        fileHandle = nil
        finished = true
        server.handler(url, fileName, mimeType) { [self] result in
            server.queue.async { self.respondJSON(status: result.ok ? 200 : 422, result) }
        }
    }

    private func abort() {
        try? fileHandle?.close()
        fileHandle = nil
        if let fileURL, written < expected {
            try? FileManager.default.removeItem(at: fileURL)
        }
        connection.cancel()
    }

    private func respondJSON(status: Int, _ result: UploadResult) {
        let message = result.message
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: " ")
        respond(status: status, contentType: "application/json; charset=utf-8",
                body: "{\"ok\":\(result.ok),\"message\":\"\(message)\"}")
    }

    private func respond(status: Int, contentType: String = "text/plain; charset=utf-8", body: String) {
        finished = true
        let bodyData = Data(body.utf8)
        let head = "HTTP/1.1 \(status) \(Self.reason(for: status))\r\n" +
            "Content-Type: \(contentType)\r\n" +
            "Content-Length: \(bodyData.count)\r\n" +
            "Cache-Control: no-store\r\n" +
            "Connection: close\r\n\r\n"
        connection.send(content: Data(head.utf8) + bodyData, completion: .contentProcessed { [self] _ in
            connection.cancel()
        })
    }

    private static func reason(for status: Int) -> String {
        switch status {
        case 200: return "OK"
        case 404: return "Not Found"
        case 411: return "Length Required"
        case 413: return "Payload Too Large"
        case 422: return "Unprocessable Entity"
        case 500: return "Internal Server Error"
        default: return "Bad Request"
        }
    }

    private static let expiredPage = """
    <!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>Link expirado</title></head>
    <body style="font:18px/1.5 -apple-system,sans-serif;padding:32px;color:#18212b;background:#f2f4f7">
    <h1 style="font-size:24px">Este link expirou</h1>
    <p>Toque em <b>Do celular</b> na tela do quiosque e leia o QR Code de novo.</p></body></html>
    """
}
