package br.com.somainfo.quioco

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Mercado Pago Point (Point Smart 1/2, Point Pro 2) through the Orders API: the kiosk sends the
 * amount to the store's card terminal and the customer pays there with a chip card, a contactless
 * card, Apple Pay or Google Pay. The terminal must be in PDV mode (set from Configurações).
 */
class PointService(private val accessToken: String) {

    enum class Status { PENDING, APPROVED, FAILED }

    data class Terminal(val id: String, val operatingMode: String)

    suspend fun terminals(): List<Terminal> = withContext(Dispatchers.IO) {
        val json = send("terminals/v1/list?limit=50", "GET")
        val array = json.optJSONObject("data")?.optJSONArray("terminals") ?: JSONArray()
        val list = (0 until array.length()).mapNotNull { i ->
            val t = array.optJSONObject(i) ?: return@mapNotNull null
            t.optString("id").takeIf { it.isNotEmpty() }?.let { Terminal(it, t.optString("operating_mode")) }
        }
        if (list.isEmpty()) {
            throw PixException("Nenhuma maquininha Point encontrada nesta conta do Mercado Pago. Vincule a Point no app do Mercado Pago e tente de novo.")
        }
        list
    }

    /** Puts the terminal in the mode where it waits for amounts sent by a system. */
    suspend fun setPdvMode(terminalId: String) {
        withContext(Dispatchers.IO) {
            val body = JSONObject().put(
                "terminals",
                JSONArray().put(JSONObject().put("id", terminalId).put("operating_mode", "PDV")),
            )
            send("terminals/v1/setup", "PATCH", body)
        }
    }

    /** Sends the amount to the terminal; returns the order id. */
    suspend fun createOrder(terminalId: String, amountCents: Int, seconds: Int, description: String): String =
        withContext(Dispatchers.IO) {
            val amount = "%d.%02d".format(amountCents / 100, amountCents % 100)
            val duration = if (seconds % 60 == 0) "PT${seconds / 60}M" else "PT${maxOf(30, seconds)}S"
            val body = JSONObject()
                .put("type", "point")
                .put("external_reference", "quioco-" + UUID.randomUUID().toString().replace("-", "").take(20))
                .put("expiration_time", duration)
                .put("description", description.take(150))
                .put("transactions", JSONObject().put("payments", JSONArray().put(JSONObject().put("amount", amount))))
                .put("config", JSONObject().put("point", JSONObject().put("terminal_id", terminalId).put("print_on_terminal", "no_ticket")))
            val json = send("v1/orders", "POST", body, mapOf("X-Idempotency-Key" to UUID.randomUUID().toString()))
            json.optString("id").ifEmpty { throw PixException("O Mercado Pago enviou uma resposta inesperada. Tente de novo.") }
        }

    suspend fun status(orderId: String): Status = withContext(Dispatchers.IO) {
        map(send("v1/orders/$orderId", "GET"))
    }

    /** Cancels the order on the terminal; returns APPROVED if it was paid meanwhile. */
    suspend fun cancel(orderId: String): Status = withContext(Dispatchers.IO) {
        val result = try {
            map(send("v1/orders/$orderId/cancel", "POST", null, mapOf(
                "X-Idempotency-Key" to UUID.randomUUID().toString(),
                "x-allow-cancelable-status" to "at_terminal",
            )))
        } catch (e: PixException) {
            Status.PENDING
        }
        if (result == Status.APPROVED) return@withContext Status.APPROVED
        try { if (map(send("v1/orders/$orderId", "GET")) == Status.APPROVED) Status.APPROVED else Status.FAILED } catch (e: PixException) { Status.FAILED }
    }

    private fun map(order: JSONObject): Status = when (order.optString("status")) {
        "processed" -> Status.APPROVED
        "failed", "canceled", "expired", "refunded" -> Status.FAILED
        else -> Status.PENDING // created, at_terminal, action_required
    }

    private fun send(path: String, method: String, body: JSONObject? = null, headers: Map<String, String> = emptyMap()): JSONObject {
        val connection = try {
            URL(BASE_URL + path).openConnection() as HttpURLConnection
        } catch (e: IOException) {
            throw PixException(NETWORK_ERROR)
        }
        try {
            // Android's HttpURLConnection (OkHttp inside) accepts PATCH; plain Java doesn't.
            try {
                connection.requestMethod = method
            } catch (e: java.net.ProtocolException) {
                connection.requestMethod = "POST"
                connection.setRequestProperty("X-HTTP-Method-Override", method)
            }
            connection.connectTimeout = 20_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("Authorization", "Bearer $accessToken")
            connection.setRequestProperty("Content-Type", "application/json")
            headers.forEach { (k, v) -> connection.setRequestProperty(k, v) }
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            } else if (method == "POST") {
                connection.doOutput = true
                connection.outputStream.use { it.write(ByteArray(0)) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (code in 200..299) return json
            val message = json.optString("message").ifEmpty {
                json.optJSONArray("errors")?.optJSONObject(0)?.optString("message").orEmpty()
            }.ifEmpty { "erro HTTP $code" }
            throw PixException("O Mercado Pago recusou: $message")
        } catch (e: IOException) {
            throw PixException(NETWORK_ERROR)
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val BASE_URL = "https://api.mercadopago.com/"
        const val NETWORK_ERROR = "Sem conexão com o Mercado Pago. Verifique a internet do tablet e tente de novo."
    }
}
