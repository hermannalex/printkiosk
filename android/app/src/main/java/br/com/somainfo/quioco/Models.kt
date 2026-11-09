package br.com.somainfo.quioco

import androidx.compose.ui.graphics.ImageBitmap
import java.io.File
import java.util.UUID

enum class ItemKind { IMAGE, PDF }

/** A photo or PDF the customer added, copied into the app's cache for this session. */
data class PrintItem(
    val id: String = UUID.randomUUID().toString(),
    val file: File,
    val kind: ItemKind,
    val name: String,
    val pageCount: Int,
    val thumbnail: ImageBitmap?,
)

sealed interface KioskStep {
    data object Welcome : KioskStep
    data object Select : KioskStep
    data object Review : KioskStep
    /** Pix, card on the Point terminal, or a credit voucher. */
    data object ChooseMethod : KioskStep
    data object Voucher : KioskStep
    data object Payment : KioskStep
    data object Printing : KioskStep
    data class Finished(val success: Boolean, val message: String?) : KioskStep
}

/** How a print was paid: "pix", "card" or "voucher", with the Mercado Pago id or the voucher use reference. */
data class Paid(val method: String, val id: String, val amountCents: Int)

/** A Pix charge created on Mercado Pago. `qrCode` is the "Pix copia e cola" payload. */
data class PixCharge(val id: Long, val qrCode: String, val amountCents: Int)

sealed interface PaymentState {
    data object Preparing : PaymentState
    data class Waiting(val charge: PixCharge) : PaymentState
    /** The amount is on the Point terminal; the customer pays there (chip, contactless, Apple/Google Pay). */
    data class CardWaiting(val orderId: String, val amountCents: Int) : PaymentState
    data object Expired : PaymentState
    data class Failed(val message: String) : PaymentState
}

data class KioskSettings(
    val kioskName: String = "Estação de Impressão",
    /** Legacy plain-text PIN from older versions; moved to AdminLock (hash) and then cleared. */
    val adminPin: String = "",
    val idleTimeoutSeconds: Int = 90,
    val maxCopies: Int = 10,
    val maxItems: Int = 20,
    /** 0 means printing is free and the Pix step is skipped. */
    val pricePerPageCents: Int = 0,
    /** Mercado Pago requires a payer e-mail on every Pix charge; the store's own e-mail works. */
    val payerEmail: String = "",
    val paymentTimeoutSeconds: Int = 300,
    /** Optional guest Wi-Fi shown as a QR Code, so customers' phones can join before sending files. */
    val wifiName: String = "",
    val wifiPassword: String = "",
) {
    /** What the dashboard sees and can change (printer, PIN and Pix token stay on the device). */
    fun toRemoteJson(): org.json.JSONObject = org.json.JSONObject()
        .put("kioskName", kioskName).put("pricePerPageCents", pricePerPageCents)
        .put("maxCopies", maxCopies).put("maxItems", maxItems)
        .put("idleTimeoutSeconds", idleTimeoutSeconds).put("paymentTimeoutSeconds", paymentTimeoutSeconds)
        .put("payerEmail", payerEmail).put("wifiName", wifiName).put("wifiPassword", wifiPassword)

    /** Takes each value from the dashboard (web/lib/kiosk-config.ts) within the settings screen's limits. */
    fun applyRemote(o: org.json.JSONObject): KioskSettings {
        fun int(key: String, ok: (Int) -> Boolean): Int? =
            if (o.has(key) && !o.isNull(key)) o.optInt(key, Int.MIN_VALUE).takeIf { it != Int.MIN_VALUE && ok(it) } else null
        fun str(key: String): String? = if (o.has(key) && !o.isNull(key)) o.optString(key) else null
        return copy(
            kioskName = str("kioskName")?.trim()?.takeIf { it.isNotEmpty() }?.take(40) ?: kioskName,
            pricePerPageCents = int("pricePerPageCents") { it in 0..5_000 } ?: pricePerPageCents,
            maxCopies = int("maxCopies") { it in 1..50 } ?: maxCopies,
            maxItems = int("maxItems") { it in 1..50 } ?: maxItems,
            idleTimeoutSeconds = int("idleTimeoutSeconds") { it in listOf(30, 60, 90, 120, 300) } ?: idleTimeoutSeconds,
            paymentTimeoutSeconds = int("paymentTimeoutSeconds") { it in listOf(120, 180, 300, 600) } ?: paymentTimeoutSeconds,
            payerEmail = str("payerEmail")?.takeIf { it.isEmpty() || it.contains("@") }?.take(254) ?: payerEmail,
            wifiName = str("wifiName")?.take(32) ?: wifiName,
            wifiPassword = str("wifiPassword")?.take(63) ?: wifiPassword,
        )
    }
}

/** Whether this kiosk may print: monthly subscription or the free demo. */
sealed interface LicenseState {
    data class Active(val until: java.time.LocalDate) : LicenseState
    data class Demo(val remaining: Int) : LicenseState
    data class Expired(val on: java.time.LocalDate) : LicenseState
    data object DemoOver : LicenseState
}

/** The "Do celular" panel: customers send files from their phone over the store's Wi-Fi. */
sealed interface PhoneUploadState {
    data object Starting : PhoneUploadState
    data class Ready(val url: String) : PhoneUploadState
    data class Unavailable(val message: String) : PhoneUploadState
}
