package br.com.somainfo.quioco

import android.content.Context
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.time.Instant

/** One finished print, as reported to the online dashboard. */
data class PrintJobRecord(
    val id: String,
    val printedAt: String,
    val items: Int,
    val pages: Int,
    val copies: Int,
    val totalPages: Int,
    val amountCents: Int,
    val paidWithPix: Boolean,
    val pixPaymentId: String?,
    val success: Boolean,
    val demo: Boolean,
    /** "pix", "card" or "voucher"; null when free. */
    val paymentMethod: String? = null,
    val paymentId: String? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("printedAt", printedAt).put("items", items).put("pages", pages)
        .put("copies", copies).put("totalPages", totalPages).put("amountCents", amountCents)
        .put("paidWithPix", paidWithPix).put("pixPaymentId", pixPaymentId ?: JSONObject.NULL)
        .put("success", success).put("demo", demo)
        .put("paymentMethod", paymentMethod ?: JSONObject.NULL).put("paymentId", paymentId ?: JSONObject.NULL)

    companion object {
        fun fromJson(o: JSONObject) = PrintJobRecord(
            id = o.getString("id"),
            printedAt = o.getString("printedAt"),
            items = o.optInt("items"),
            pages = o.optInt("pages"),
            copies = o.optInt("copies"),
            totalPages = o.optInt("totalPages"),
            amountCents = o.optInt("amountCents"),
            paidWithPix = o.optBoolean("paidWithPix"),
            pixPaymentId = if (o.isNull("pixPaymentId")) null else o.optString("pixPaymentId"),
            success = o.optBoolean("success", true),
            demo = o.optBoolean("demo"),
            paymentMethod = if (o.isNull("paymentMethod")) null else o.optString("paymentMethod").ifEmpty { null },
            paymentId = if (o.isNull("paymentId")) null else o.optString("paymentId").ifEmpty { null },
        )
    }
}

data class SyncResponse(
    val ok: Boolean,
    val activationCode: String?,
    val dashboardUrl: String?,
    val error: String?,
    /** Settings saved in the dashboard, applied when [configVersion] is newer than the last one applied. */
    val config: JSONObject? = null,
    val configVersion: Int = 0,
)

/**
 * Talks to the PrintKiosk dashboard: sends the print history and picks up the month's
 * activation code, so a paid subscription reaches the kiosk without anyone typing it.
 * Prints are queued on the device and sent whenever there is internet.
 */
class CloudSync(context: Context) {
    companion object {
        const val SERVER_URL = "https://quioco.vercel.app"
        fun isoNow(): String = Instant.now().toString()
    }

    private val prefs = context.getSharedPreferences("kiosk_sync", Context.MODE_PRIVATE)
    private val mutex = Mutex()

    /** Random per-device secret; the server binds the store code to it on first contact. */
    private val secret: String
        get() = prefs.getString("secret", null)?.takeIf { it.length >= 16 }
            ?: ByteArray(24).also { SecureRandom().nextBytes(it) }
                .let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) }
                .also { prefs.edit().putString("secret", it).apply() }

    /**
     * Proves to the dashboard that whoever adds this kiosk has its Configurações open.
     * Same derivation as web/lib/license.ts `pairingCode`: base32(sha256("pair:" + sha256hex(secret))), 6 chars.
     */
    val pairingCode: String
        get() {
            val sha = { bytes: ByteArray -> java.security.MessageDigest.getInstance("SHA-256").digest(bytes) }
            val secretHash = sha(secret.toByteArray()).joinToString("") { "%02x".format(it) }
            val digest = sha("pair:$secretHash".toByteArray())
            val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
            var bits = 0L
            for (i in 0 until 5) bits = (bits shl 8) or (digest[i].toLong() and 0xff)
            val text = (7 downTo 0).map { alphabet[((bits shr (it * 5)) and 31).toInt()] }.take(6).joinToString("")
            return text.take(3) + "-" + text.takeLast(3)
        }

    private var queue: List<PrintJobRecord>
        get() {
            val text = prefs.getString("queue", null) ?: return emptyList()
            return runCatching {
                val array = JSONArray(text)
                (0 until array.length()).map { PrintJobRecord.fromJson(array.getJSONObject(it)) }
            }.getOrDefault(emptyList())
        }
        set(value) {
            val array = JSONArray()
            value.takeLast(2000).forEach { array.put(it.toJson()) }
            prefs.edit().putString("queue", array.toString()).apply()
        }

    val lastSync: Long? get() = prefs.getLong("lastSync", 0L).takeIf { it > 0 }
    val dashboardUrl: String get() = prefs.getString("dashboardUrl", null) ?: SERVER_URL

    /** Last dashboard settings version applied on this device (0 = none yet). */
    var appliedConfigVersion: Int
        get() = prefs.getInt("configVersion", 0)
        set(value) { prefs.edit().putInt("configVersion", value).apply() }

    @Synchronized
    fun record(job: PrintJobRecord) {
        queue = queue + job
    }

    /** Sends queued prints and returns the server's answer, or null when offline. */
    suspend fun sync(storeCode: String, license: LicenseState, appVersion: String, config: JSONObject): SyncResponse? =
        mutex.withLock {
            withContext(Dispatchers.IO) {
                val pending = queue.take(200)
                val (state, demoRemaining) = when (license) {
                    is LicenseState.Active -> "active" to null
                    is LicenseState.Expired -> "expired" to null
                    is LicenseState.Demo -> "demo" to license.remaining
                    LicenseState.DemoOver -> "demoOver" to 0
                }
                val body = JSONObject()
                    .put("storeCode", storeCode)
                    .put("secret", secret)
                    .put("platform", "Android")
                    .put("appVersion", appVersion)
                    .put("licenseState", state)
                    .put("demoRemaining", demoRemaining ?: JSONObject.NULL)
                    .put("config", config)
                    .put("configVersion", appliedConfigVersion)
                    .put("jobs", JSONArray().also { array -> pending.forEach { array.put(it.toJson()) } })

                try {
                    val connection = (URL("$SERVER_URL/api/kiosk/sync").openConnection() as HttpURLConnection).apply {
                        requestMethod = "POST"
                        connectTimeout = 15_000
                        readTimeout = 20_000
                        doOutput = true
                        setRequestProperty("Content-Type", "application/json")
                    }
                    connection.outputStream.use { it.write(body.toString().toByteArray()) }
                    val status = connection.responseCode
                    val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
                        ?.bufferedReader()?.use { it.readText() } ?: ""
                    connection.disconnect()
                    val json = runCatching { JSONObject(text) }.getOrNull() ?: return@withContext null

                    if (status != 200) {
                        return@withContext SyncResponse(false, null, null, json.optString("error", "Erro $status"))
                    }
                    // The server stores each job once (by id), so the whole batch is done.
                    val sent = pending.map { it.id }.toSet()
                    synchronized(this@CloudSync) { queue = queue.filterNot { it.id in sent } }
                    val dashboard = json.optString("dashboardUrl").takeIf { it.isNotBlank() && it != "null" }
                    prefs.edit().putLong("lastSync", System.currentTimeMillis())
                        .apply { if (dashboard != null) putString("dashboardUrl", dashboard) }
                        .apply()
                    SyncResponse(
                        ok = true,
                        activationCode = if (json.isNull("activationCode")) null else json.optString("activationCode"),
                        dashboardUrl = dashboard,
                        error = null,
                        config = json.optJSONObject("config"),
                        configVersion = json.optInt("configVersion", 0),
                    )
                } catch (e: Exception) {
                    null
                }
            }
        }

    /**
     * Credit vouchers made in the dashboard (Painel › Vouchers). `action` is "redeem" (with code,
     * amountCents and a fresh ref; a retry with the same ref is safe) or "refund" (ref only).
     * Returns the server's JSON, or null when offline.
     */
    suspend fun voucher(storeCode: String, action: String, code: String?, amountCents: Int, ref: String): JSONObject? =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("storeCode", storeCode)
                .put("secret", secret)
                .put("action", action)
                .put("code", code ?: JSONObject.NULL)
                .put("amountCents", amountCents)
                .put("ref", ref)
            try {
                val connection = (URL("$SERVER_URL/api/kiosk/voucher").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 15_000
                    readTimeout = 15_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
                val status = connection.responseCode
                val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
                    ?.bufferedReader()?.use { it.readText() } ?: ""
                connection.disconnect()
                runCatching { JSONObject(text) }.getOrNull()
            } catch (e: Exception) {
                null
            }
        }
}
