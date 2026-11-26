package br.com.somainfo.quioco

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Prints straight to a network printer over IPP (Internet Printing Protocol), with no Android print window.
 *
 * Almost every network printer made since ~2015 speaks IPP on port 631 (the same protocol AirPrint uses).
 * The job is a PDF; printers that cannot read PDF are detected up front by [probe].
 *
 * Plain sockets are used on purpose: Android blocks cleartext http:// to the local network for
 * HttpURLConnection, and IPP on the store's own Wi-Fi is cleartext. This file has no Android imports,
 * so it is unit-tested on the JVM.
 */
object Ipp {
    class IppException(message: String) : Exception(message)

    /** Where a printer lives: host, port and path of its IPP endpoint. */
    data class Target(val host: String, val port: Int, val path: String) {
        val uri get() = "ipp://$host:$port$path"
        val display get() = if (port == 631 && path == "/ipp/print") host else "$host:$port$path"
    }

    /** Printer answer: IPP status code and every attribute it sent (all values as text). */
    class Response(val status: Int, val attributes: Map<String, List<String>>) {
        val ok get() = status in 0x0000..0x00FF // successful-ok and its "ignored/substituted" variants
        fun first(name: String) = attributes[name]?.firstOrNull()
    }

    const val OP_PRINT_JOB = 0x0002
    const val OP_GET_JOB_ATTRIBUTES = 0x0009
    const val OP_GET_PRINTER_ATTRIBUTES = 0x000B

    // IPP job-state values (RFC 8011).
    const val JOB_CANCELED = 7
    const val JOB_ABORTED = 8
    const val JOB_COMPLETED = 9

    private const val CONNECT_TIMEOUT_MS = 5_000
    private const val READ_TIMEOUT_MS = 60_000

    /** Accepts "192.168.0.20", "192.168.0.20:631", "impressora.local" or "ipp://host:631/ipp/print". */
    fun parseTarget(input: String): Target? {
        var text = input.trim()
        if (text.isEmpty()) return null
        var path = "/ipp/print"
        var port = 631
        val scheme = Regex("^([a-zA-Z]+)://").find(text)
        if (scheme != null) {
            if (scheme.groupValues[1].lowercase() !in setOf("ipp", "http")) return null // ipps/https need TLS
            text = text.substring(scheme.value.length)
        }
        val slash = text.indexOf('/')
        if (slash >= 0) {
            path = text.substring(slash).ifBlank { path }
            text = text.substring(0, slash)
        }
        val colon = text.lastIndexOf(':')
        if (colon >= 0 && !text.endsWith("]")) {
            port = text.substring(colon + 1).toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
            text = text.substring(0, colon)
        }
        val host = text.trim('[', ']')
        if (host.isEmpty() || !host.matches(Regex("[A-Za-z0-9._:-]+"))) return null
        return Target(host, port, path.replace(Regex("[^A-Za-z0-9/._~%-]"), ""))
    }

    // ------------------------------------------------------------------ operations

    /** Asks which formats the printer accepts and whether it is ready. Throws [IppException] with a plain message. */
    fun probe(target: Target): Probe {
        val response = send(target, buildRequest(OP_GET_PRINTER_ATTRIBUTES, target, requested = listOf(
            "printer-name", "printer-make-and-model", "printer-state", "document-format-supported",
        )))
        if (!response.ok) throw IppException(statusMessage(response.status))
        val formats = response.attributes["document-format-supported"].orEmpty()
        return Probe(
            name = response.first("printer-make-and-model") ?: response.first("printer-name") ?: target.host,
            acceptsPdf = formats.any { it.equals("application/pdf", ignoreCase = true) },
            formats = formats,
        )
    }

    class Probe(val name: String, val acceptsPdf: Boolean, val formats: List<String>)

    /** Sends the PDF. Returns the job id the printer assigned (or null if it did not say). */
    fun printPdf(target: Target, pdf: ByteArray, jobName: String, userName: String = "imprime-ai"): Int? {
        val response = send(
            target,
            buildRequest(OP_PRINT_JOB, target, jobName = jobName, userName = userName, documentFormat = "application/pdf"),
            body = pdf,
        )
        if (!response.ok) throw IppException(statusMessage(response.status))
        return response.first("job-id")?.toIntOrNull()
    }

    /** The job's state (see JOB_* constants), or null when the printer will not say. */
    fun jobState(target: Target, jobId: Int): Int? {
        val response = send(target, buildRequest(OP_GET_JOB_ATTRIBUTES, target, jobId = jobId, requested = listOf("job-state")))
        return if (response.ok) response.first("job-state")?.toIntOrNull() else null
    }

    fun statusMessage(status: Int): String = when (status) {
        0x0400 -> "A impressora não entendeu o pedido."
        0x0401, 0x0402 -> "A impressora recusou o acesso."
        0x0404 -> "O endereço da impressora está incompleto ou errado."
        0x0405 -> "A impressora não foi encontrada nesse endereço."
        0x040A, 0x040B -> "A impressora não aceita arquivos PDF."
        0x0501, 0x0502 -> "A impressora está ocupada ou indisponível. Tente de novo em instantes."
        0x0507 -> "A impressora está ocupada. Tente de novo em instantes."
        else -> "A impressora respondeu com erro (código 0x%04X).".format(status)
    }

    // ------------------------------------------------------------------ protocol

    internal fun buildRequest(
        operation: Int,
        target: Target,
        requestId: Int = 1,
        jobName: String? = null,
        userName: String? = null,
        documentFormat: String? = null,
        jobId: Int? = null,
        requested: List<String> = emptyList(),
    ): ByteArray {
        val out = ByteArrayOutputStream()
        val data = DataOutputStream(out)
        data.writeShort(0x0101) // IPP 1.1
        data.writeShort(operation)
        data.writeInt(requestId)
        data.writeByte(0x01) // operation-attributes-tag

        fun attribute(tag: Int, name: String, value: ByteArray) {
            data.writeByte(tag)
            data.writeShort(name.length)
            data.writeBytes(name)
            data.writeShort(value.size)
            data.write(value)
        }
        fun text(tag: Int, name: String, value: String) = attribute(tag, name, value.toByteArray(Charsets.UTF_8))

        text(0x47, "attributes-charset", "utf-8")
        text(0x48, "attributes-natural-language", "en")
        text(0x45, "printer-uri", target.uri)
        if (jobId != null) {
            attribute(0x21, "job-id", ByteArray(4).also { for (i in 0..3) it[i] = (jobId shr (24 - 8 * i)).toByte() })
        }
        if (userName != null) text(0x42, "requesting-user-name", userName.take(60))
        if (jobName != null) text(0x42, "job-name", jobName.take(120))
        if (documentFormat != null) text(0x49, "document-format", documentFormat)
        requested.forEachIndexed { index, name ->
            // Extra values of the same attribute are sent with an empty name.
            val bytes = name.toByteArray(Charsets.UTF_8)
            data.writeByte(0x44)
            if (index == 0) {
                data.writeShort("requested-attributes".length)
                data.writeBytes("requested-attributes")
            } else {
                data.writeShort(0)
            }
            data.writeShort(bytes.size)
            data.write(bytes)
        }
        data.writeByte(0x03) // end-of-attributes-tag
        return out.toByteArray()
    }

    internal fun parseResponse(bytes: ByteArray): Response {
        if (bytes.size < 8) throw IppException("Resposta inválida da impressora.")
        val status = ((bytes[2].toInt() and 0xFF) shl 8) or (bytes[3].toInt() and 0xFF)
        val attributes = linkedMapOf<String, MutableList<String>>()
        var pos = 8
        var lastName = ""
        fun u16(at: Int) = ((bytes[at].toInt() and 0xFF) shl 8) or (bytes[at + 1].toInt() and 0xFF)
        while (pos < bytes.size) {
            val tag = bytes[pos].toInt() and 0xFF
            pos++
            if (tag == 0x03) break // end of attributes
            if (tag <= 0x0F) continue // group delimiter (operation, job, printer… attributes)
            if (pos + 2 > bytes.size) break
            val nameLength = u16(pos)
            pos += 2
            if (pos + nameLength + 2 > bytes.size) break
            val name = if (nameLength == 0) lastName else String(bytes, pos, nameLength, Charsets.UTF_8)
            pos += nameLength
            val valueLength = u16(pos)
            pos += 2
            if (pos + valueLength > bytes.size) break
            val value = when (tag) {
                0x21, 0x23 -> { // integer, enum: big-endian signed
                    var n = 0L
                    for (i in 0 until valueLength) n = (n shl 8) or (bytes[pos + i].toLong() and 0xFF)
                    n.toString()
                }
                0x22 -> if (valueLength > 0 && bytes[pos].toInt() != 0) "true" else "false"
                else -> String(bytes, pos, valueLength, Charsets.UTF_8)
            }
            pos += valueLength
            attributes.getOrPut(name) { mutableListOf() }.add(value)
            lastName = name
        }
        return Response(status, attributes)
    }

    // ------------------------------------------------------------------ transport (HTTP/1.1 over a plain socket)

    private fun send(target: Target, ipp: ByteArray, body: ByteArray? = null): Response {
        val length = ipp.size + (body?.size ?: 0)
        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(target.host, target.port), CONNECT_TIMEOUT_MS)
                socket.soTimeout = READ_TIMEOUT_MS
                val out = socket.getOutputStream()
                val head = "POST ${target.path} HTTP/1.1\r\n" +
                    "Host: ${target.host}:${target.port}\r\n" +
                    "Content-Type: application/ipp\r\n" +
                    "Content-Length: $length\r\n" +
                    "Connection: close\r\n\r\n"
                out.write(head.toByteArray(Charsets.US_ASCII))
                out.write(ipp)
                if (body != null) out.write(body)
                out.flush()
                return parseResponse(readHttpBody(socket.getInputStream()))
            }
        } catch (e: IppException) {
            throw e
        } catch (e: java.net.SocketTimeoutException) {
            throw IppException("A impressora demorou demais para responder.")
        } catch (e: java.io.IOException) {
            throw IppException("Não consegui falar com a impressora. Confira se ela está ligada e na mesma rede.")
        }
    }

    private fun readHttpBody(input: InputStream): ByteArray {
        val all = input.readBytes()
        val split = indexOf(all, "\r\n\r\n".toByteArray(Charsets.US_ASCII))
        if (split < 0) throw IppException("Resposta inválida da impressora.")
        val header = String(all, 0, split, Charsets.ISO_8859_1)
        val code = Regex("^HTTP/1\\.[01] (\\d{3})").find(header)?.groupValues?.get(1)?.toIntOrNull()
        if (code == null || code !in 200..299) {
            throw IppException(
                when (code) {
                    401, 403 -> "A impressora pediu senha. Impressão direta não funciona com ela."
                    404 -> "A impressora não foi encontrada nesse endereço (caminho incorreto)."
                    426 -> "Esta impressora só aceita conexão segura (ipps), que o app não usa."
                    else -> "A impressora respondeu com erro HTTP ${code ?: "?"}."
                },
            )
        }
        val body = all.copyOfRange(split + 4, all.size)
        return if (header.contains("transfer-encoding: chunked", ignoreCase = true)) dechunk(body) else body
    }

    private fun dechunk(raw: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        var pos = 0
        while (pos < raw.size) {
            val lineEnd = indexOf(raw, "\r\n".toByteArray(Charsets.US_ASCII), pos)
            if (lineEnd < 0) break
            val size = String(raw, pos, lineEnd - pos, Charsets.US_ASCII).substringBefore(';').trim().toIntOrNull(16) ?: break
            pos = lineEnd + 2
            if (size == 0 || pos + size > raw.size) break
            out.write(raw, pos, size)
            pos += size + 2
        }
        return out.toByteArray()
    }

    private fun indexOf(haystack: ByteArray, needle: ByteArray, from: Int = 0): Int {
        outer@ for (i in from..haystack.size - needle.size) {
            for (j in needle.indices) if (haystack[i + j] != needle[j]) continue@outer
            return i
        }
        return -1
    }
}
