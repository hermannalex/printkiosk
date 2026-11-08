package br.com.somainfo.printkiosk

import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.Base64

/**
 * Monthly activation codes. A code is `PK1-` + base64url(payload + ECDSA signature), where
 * payload = version (1 byte) + store ID (5 bytes) + last valid day (2 bytes, days since 2024-01-01).
 * Codes are made with tools/gerar-codigo.py and the private key, which never ships in the app.
 */
object LicenseCodec {
    const val DEMO_PRINTS = 5
    const val PRICE_LABEL = "a partir de R\$ 19,99/mês"
    const val VENDOR_CONTACT = "alex@somainfo.com.br"

    private const val VERSION: Byte = 1
    private const val PAYLOAD_SIZE = 8
    private val EPOCH: LocalDate = LocalDate.of(2024, 1, 1)

    /** Public half of the signing key (X.509 SubjectPublicKeyInfo, P-256). */
    private const val PUBLIC_KEY =
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvKAdZ2rVE+ExL+GWj0OJcDS05O4NnOBt8hAXeUANqC/aX1J2RW9cpXoDr78Xag57U0tm1Vo2oO90bSO95fiYYw=="

    private const val BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    /** "ABCD-EFGH" for a 5-byte store ID. */
    fun storeCode(storeId: ByteArray): String {
        var bits = 0L
        for (b in storeId) bits = (bits shl 8) or (b.toLong() and 0xFF)
        val chars = (7 downTo 0).map { BASE32[((bits shr (it * 5)) and 31).toInt()] }.joinToString("")
        return chars.substring(0, 4) + "-" + chars.substring(4)
    }

    fun dayNumber(date: LocalDate): Int = ChronoUnit.DAYS.between(EPOCH, date).toInt()

    fun date(dayNumber: Int): LocalDate = EPOCH.plusDays(dayNumber.toLong())

    /** Returns the last valid day number, or null when the code is not valid for this store. */
    fun verify(code: String, storeId: ByteArray): Int? {
        val cleaned = code.filterNot { it.isWhitespace() }.removePrefix("PK1-").removePrefix("pk1-")
        val data = try { Base64.getUrlDecoder().decode(cleaned) } catch (e: IllegalArgumentException) { return null }
        if (data.size <= PAYLOAD_SIZE) return null

        val payload = data.copyOfRange(0, PAYLOAD_SIZE)
        val signature = data.copyOfRange(PAYLOAD_SIZE, data.size)
        if (payload[0] != VERSION) return null
        if (!payload.copyOfRange(1, 6).contentEquals(storeId)) return null

        val valid = try {
            val key = KeyFactory.getInstance("EC")
                .generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(PUBLIC_KEY)))
            Signature.getInstance("SHA256withECDSA").run {
                initVerify(key)
                update(payload)
                verify(signature)
            }
        } catch (e: Exception) {
            false
        }
        if (!valid) return null

        return ((payload[6].toInt() and 0xFF) shl 8) or (payload[7].toInt() and 0xFF)
    }
}
