package br.com.somainfo.printkiosk

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.math.BigDecimal
import java.net.HttpURLConnection
import java.net.URL
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID

class PixException(message: String) : Exception(message)

/**
 * Talks to the Mercado Pago Payments API to create Pix charges and check their status.
 * Docs: https://www.mercadopago.com.br/developers/pt/docs (Checkout Transparente › Pix)
 */
class PixService(private val accessToken: String) {

    enum class Status {
        PENDING, APPROVED, AUTHORIZED, IN_PROCESS, IN_MEDIATION,
        REJECTED, CANCELLED, REFUNDED, CHARGED_BACK, UNKNOWN;

        val isFinalFailure: Boolean
            get() = this == REJECTED || this == CANCELLED || this == REFUNDED || this == CHARGED_BACK
    }

    /**
     * Creates a Pix charge. Mercado Pago requires an expiration of at least 30 minutes;
     * the kiosk cancels the charge itself much sooner if nobody pays.
     */
    suspend fun createCharge(amountCents: Int, description: String, payerEmail: String): PixCharge =
        withContext(Dispatchers.IO) {
            val expiration = OffsetDateTime.now().plusMinutes(30)
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX"))

            val body = JSONObject()
                .put("transaction_amount", BigDecimal(amountCents).movePointLeft(2))
                .put("description", description)
                .put("payment_method_id", "pix")
                .put("payer", JSONObject().put("email", payerEmail))
                .put("date_of_expiration", expiration)

            val json = send("v1/payments", "POST", body, idempotencyKey = UUID.randomUUID().toString())

            val id = json.optLong("id", -1L)
            val qrCode = json.optJSONObject("point_of_interaction")
                ?.optJSONObject("transaction_data")
                ?.optString("qr_code")
                .orEmpty()

            if (id < 0 || qrCode.isEmpty()) {
                throw PixException("O Mercado Pago enviou uma resposta inesperada. Tente de novo.")
            }
            PixCharge(id = id, qrCode = qrCode, amountCents = amountCents)
        }

    suspend fun status(paymentId: Long): Status = withContext(Dispatchers.IO) {
        when (send("v1/payments/$paymentId", "GET").optString("status")) {
            "pending" -> Status.PENDING
            "approved" -> Status.APPROVED
            "authorized" -> Status.AUTHORIZED
            "in_process" -> Status.IN_PROCESS
            "in_mediation" -> Status.IN_MEDIATION
            "rejected" -> Status.REJECTED
            "cancelled" -> Status.CANCELLED
            "refunded" -> Status.REFUNDED
            "charged_back" -> Status.CHARGED_BACK
            else -> Status.UNKNOWN
        }
    }

    /** Cancels a charge that hasn't been paid yet, so the QR Code stops working. */
    suspend fun cancel(paymentId: Long) {
        withContext(Dispatchers.IO) {
            send("v1/payments/$paymentId", "PUT", JSONObject().put("status", "cancelled"))
        }
    }

    /** Used by "Testar conexão" in the staff settings. */
    suspend fun accountName(): String = withContext(Dispatchers.IO) {
        val json = send("users/me", "GET")
        json.optString("nickname").ifEmpty { json.optString("email") }.ifEmpty { "Mercado Pago" }
    }

    private fun send(
        path: String,
        method: String,
        body: JSONObject? = null,
        idempotencyKey: String? = null,
    ): JSONObject {
        val connection = try {
            URL(BASE_URL + path).openConnection() as HttpURLConnection
        } catch (e: IOException) {
            throw PixException(NETWORK_ERROR)
        }

        try {
            connection.requestMethod = method
            connection.connectTimeout = 20_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("Authorization", "Bearer $accessToken")
            connection.setRequestProperty("Content-Type", "application/json")
            if (idempotencyKey != null) {
                connection.setRequestProperty("X-Idempotency-Key", idempotencyKey)
            }
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }

            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }

            return when {
                code in 200..299 -> json
                code == 401 || code == 403 -> throw PixException(
                    "O Mercado Pago recusou o token de acesso. Confira o token nas configurações."
                )
                else -> throw PixException(
                    "O Mercado Pago recusou a cobrança: " + json.optString("message", "erro HTTP $code")
                )
            }
        } catch (e: IOException) {
            throw PixException(NETWORK_ERROR)
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val BASE_URL = "https://api.mercadopago.com/"
        const val NETWORK_ERROR =
            "Sem conexão com o Mercado Pago. Verifique a internet do tablet e tente de novo."
    }
}
