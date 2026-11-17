package br.com.somainfo.quioco

import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * "No 4G/5G" option of "Do celular" (imprime.ai only, not imprime-free).
 *
 * The kiosk opens a session on the imprime.ai server and shows its link as a QR Code. The phone
 * uploads there over any internet connection; the kiosk lists the files every 2 seconds, downloads
 * each one and deletes it from the server. Sessions last 30 minutes; closing deletes what is left.
 * All functions block: call them on Dispatchers.IO.
 */
class RelayClient private constructor(val code: String, private val secret: String, val url: String) {

    data class RemoteFile(val pathname: String, val name: String, val size: Long)

    /** Thrown when the session ended on the server (expired or closed). */
    class SessionGone : IOException("Sessão encerrada")

    private fun connect(method: String, suffix: String, pathname: String? = null): HttpURLConnection {
        var address = "$BASE_URL/api/relay/session/$code$suffix"
        if (pathname != null) address += "?p=" + URLEncoder.encode(pathname, "UTF-8")
        return (URL(address).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 60_000
            setRequestProperty("Authorization", "Bearer $secret")
        }
    }

    fun list(): List<RemoteFile> {
        val connection = connect("GET", "/files")
        try {
            val status = connection.responseCode
            if (status == 404) throw SessionGone()
            if (status != 200) throw IOException("Erro $status")
            val json = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            val files = json.optJSONArray("files") ?: return emptyList()
            return (0 until files.length()).map { i ->
                val f = files.getJSONObject(i)
                RemoteFile(f.getString("pathname"), f.optString("name", "arquivo"), f.optLong("size"))
            }
        } finally {
            connection.disconnect()
        }
    }

    /** Saves the file in [target] and returns its content type. */
    fun download(file: RemoteFile, target: File): String {
        val connection = connect("GET", "/file", file.pathname)
        try {
            if (connection.responseCode != 200) throw IOException("Erro ${connection.responseCode}")
            var total = 0L
            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        total += n
                        if (total > MAX_BYTES) throw IOException("Arquivo grande demais. O limite é 50 MB.")
                        output.write(buffer, 0, n)
                    }
                }
            }
            if (total == 0L) throw IOException("Arquivo vazio.")
            return connection.contentType ?: ""
        } catch (e: IOException) {
            target.delete()
            throw e
        } finally {
            connection.disconnect()
        }
    }

    fun delete(file: RemoteFile) {
        runCatching { connect("DELETE", "/file", file.pathname).run { responseCode; disconnect() } }
    }

    fun close() {
        runCatching { connect("DELETE", "").run { responseCode; disconnect() } }
    }

    companion object {
        const val BASE_URL = "https://imprime-ai.vercel.app"
        const val MAX_BYTES = 50L * 1024 * 1024

        /** Opens a session, or returns null without internet. */
        fun open(kioskName: String): RelayClient? = try {
            val connection = (URL("$BASE_URL/api/relay/session").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = 20_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            connection.outputStream.use { it.write(JSONObject().put("kioskName", kioskName).toString().toByteArray()) }
            val status = connection.responseCode
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""
            connection.disconnect()
            val json = JSONObject(text)
            val code = json.optString("code")
            val secret = json.optString("secret")
            val url = json.optString("url")
            if (status == 200 && code.isNotEmpty() && secret.isNotEmpty() && url.isNotEmpty()) RelayClient(code, secret, url) else null
        } catch (e: Exception) {
            null
        }
    }
}
