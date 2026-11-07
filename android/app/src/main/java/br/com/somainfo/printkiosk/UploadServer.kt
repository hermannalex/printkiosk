package br.com.somainfo.printkiosk

import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.UUID

data class UploadResult(val ok: Boolean, val message: String)

/**
 * A tiny web server on the store's Wi-Fi. The customer's phone opens the upload page from the
 * QR Code and sends each file as the raw body of a POST. Only the address with this session's
 * random [token] works, and the server only runs while the "Do celular" panel is open.
 */
class UploadServer(
    private val token: String,
    private val page: String,
    private val directory: File,
    private val onFile: (file: File, name: String, mimeType: String) -> UploadResult,
) {
    @Volatile private var running = false
    private var serverSocket: ServerSocket? = null

    /** Starts listening on a free port and returns it. Call off the main thread. */
    fun start(): Int {
        val socket = ServerSocket(0)
        serverSocket = socket
        running = true
        Thread({ acceptLoop(socket) }, "PrintKiosk-upload").apply { isDaemon = true }.start()
        return socket.localPort
    }

    fun stop() {
        running = false
        try { serverSocket?.close() } catch (e: IOException) { }
        serverSocket = null
    }

    private fun acceptLoop(socket: ServerSocket) {
        while (running) {
            val client = try { socket.accept() } catch (e: IOException) { break }
            Thread { handle(client) }.apply { isDaemon = true }.start()
        }
    }

    private fun handle(client: Socket) {
        client.use { socket ->
            try {
                socket.soTimeout = 30_000
                val input = BufferedInputStream(socket.getInputStream())
                val output = socket.getOutputStream()
                val head = readHead(input) ?: return

                val lines = head.split("\r\n")
                val requestLine = lines.first().split(" ")
                if (requestLine.size < 2) {
                    respond(output, 400, "text/plain; charset=utf-8", "Bad request")
                    return
                }
                val method = requestLine[0]
                val target = requestLine[1]
                val path = target.substringBefore('?')
                val query = target.substringAfter('?', "")
                val headers = lines.drop(1).mapNotNull { line ->
                    val colon = line.indexOf(':')
                    if (colon <= 0) null else line.substring(0, colon).trim().lowercase() to line.substring(colon + 1).trim()
                }.toMap()

                val base = "/u/$token"
                when {
                    !running -> respond(output, 404, "text/html; charset=utf-8", EXPIRED_PAGE)
                    method == "GET" && (path == base || path == "$base/") ->
                        respond(output, 200, "text/html; charset=utf-8", page)
                    method == "POST" && path == "$base/upload" -> receiveFile(input, output, headers, query)
                    else -> respond(output, 404, "text/html; charset=utf-8", EXPIRED_PAGE)
                }
            } catch (e: IOException) {
                // The phone went away mid-request; nothing to do.
            }
        }
    }

    private fun receiveFile(input: InputStream, output: OutputStream, headers: Map<String, String>, query: String) {
        val length = headers["content-length"]?.toLongOrNull()
        if (length == null || length <= 0) {
            respondJson(output, 411, UploadResult(false, "Envio inválido. Tente de novo."))
            return
        }
        if (length > MAX_BYTES) {
            respondJson(output, 413, UploadResult(false, "Arquivo grande demais. O limite é 50 MB."))
            return
        }

        val name = query.split('&')
            .firstOrNull { it.startsWith("name=") }
            ?.substringAfter('=')
            ?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrNull() }
            ?.take(120)
            .orEmpty()
            .ifBlank { "arquivo" }
        val mimeType = headers["content-type"].orEmpty().substringBefore(';').trim().lowercase()
        val extension = name.substringAfterLast('.', "bin").lowercase().filter { it.isLetterOrDigit() }.take(5).ifEmpty { "bin" }

        directory.mkdirs()
        val file = File(directory, "${UUID.randomUUID()}.$extension")
        var remaining = length
        file.outputStream().use { out ->
            val buffer = ByteArray(64 * 1024)
            while (remaining > 0) {
                val read = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
                if (read < 0) break
                out.write(buffer, 0, read)
                remaining -= read
            }
        }
        if (remaining > 0) {
            file.delete()
            return
        }

        val result = try {
            onFile(file, name, mimeType)
        } catch (e: Exception) {
            file.delete()
            UploadResult(false, "O quiosque não conseguiu ler este arquivo.")
        }
        respondJson(output, if (result.ok) 200 else 422, result)
    }

    /** Reads the request line and headers, up to the blank line. */
    private fun readHead(input: InputStream): String? {
        val bytes = ByteArrayOutputStream()
        val end = byteArrayOf(13, 10, 13, 10)
        var matched = 0
        while (matched < 4) {
            val value = input.read()
            if (value < 0) return null
            bytes.write(value)
            matched = when {
                value.toByte() == end[matched] -> matched + 1
                value.toByte() == end[0] -> 1
                else -> 0
            }
            if (bytes.size() > 16_384) return null
        }
        return bytes.toString("ISO-8859-1").removeSuffix("\r\n\r\n")
    }

    private fun respondJson(output: OutputStream, status: Int, result: UploadResult) {
        val body = JSONObject().put("ok", result.ok).put("message", result.message).toString()
        respond(output, status, "application/json; charset=utf-8", body)
    }

    private fun respond(output: OutputStream, status: Int, contentType: String, body: String) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        val reason = when (status) {
            200 -> "OK"
            404 -> "Not Found"
            411 -> "Length Required"
            413 -> "Payload Too Large"
            422 -> "Unprocessable Entity"
            else -> "Bad Request"
        }
        val head = "HTTP/1.1 $status $reason\r\n" +
            "Content-Type: $contentType\r\n" +
            "Content-Length: ${bytes.size}\r\n" +
            "Cache-Control: no-store\r\n" +
            "Connection: close\r\n\r\n"
        output.write(head.toByteArray(Charsets.ISO_8859_1))
        output.write(bytes)
        output.flush()
    }

    companion object {
        const val MAX_BYTES = 50L * 1024 * 1024

        private const val EXPIRED_PAGE = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Link expirado</title></head>
<body style="font:18px/1.5 -apple-system,Roboto,sans-serif;padding:32px;color:#18212b;background:#f2f4f7">
<h1 style="font-size:24px">Este link expirou</h1>
<p>Toque em <b>Do celular</b> na tela do quiosque e leia o QR Code de novo.</p></body></html>"""

        /** The tablet's IPv4 address on the local network, preferring Wi-Fi. */
        fun localIpAddress(): String? = try {
            NetworkInterface.getNetworkInterfaces().toList()
                .filter { it.isUp && !it.isLoopback && !it.isVirtual }
                .sortedBy { if (it.name.startsWith("wlan")) 0 else 1 }
                .flatMap { it.inetAddresses.toList() }
                .filterIsInstance<Inet4Address>()
                .firstOrNull { it.isSiteLocalAddress }
                ?.hostAddress
        } catch (e: Exception) {
            null
        }
    }
}
