package br.com.somainfo.printkiosk

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
    data object Payment : KioskStep
    data object Printing : KioskStep
    data class Finished(val success: Boolean, val message: String?) : KioskStep
}

/** A Pix charge created on Mercado Pago. `qrCode` is the "Pix copia e cola" payload. */
data class PixCharge(val id: Long, val qrCode: String, val amountCents: Int)

sealed interface PaymentState {
    data object Preparing : PaymentState
    data class Waiting(val charge: PixCharge) : PaymentState
    data object Expired : PaymentState
    data class Failed(val message: String) : PaymentState
}

data class KioskSettings(
    val kioskName: String = "Estação de Impressão",
    val adminPin: String = "1234",
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
)

/** The "Do celular" panel: customers send files from their phone over the store's Wi-Fi. */
sealed interface PhoneUploadState {
    data object Starting : PhoneUploadState
    data class Ready(val url: String) : PhoneUploadState
    data class Unavailable(val message: String) : PhoneUploadState
}
