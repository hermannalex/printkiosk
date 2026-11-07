package br.com.somainfo.printkiosk

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.text.NumberFormat
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Kiosk settings kept in the app's private preferences. */
class SettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("kiosk_settings", Context.MODE_PRIVATE)

    fun load(): KioskSettings {
        val d = KioskSettings()
        return KioskSettings(
            kioskName = prefs.getString("kioskName", d.kioskName) ?: d.kioskName,
            adminPin = prefs.getString("adminPin", d.adminPin) ?: d.adminPin,
            idleTimeoutSeconds = prefs.getInt("idleTimeoutSeconds", d.idleTimeoutSeconds),
            maxCopies = prefs.getInt("maxCopies", d.maxCopies),
            maxItems = prefs.getInt("maxItems", d.maxItems),
            pricePerPageCents = prefs.getInt("pricePerPageCents", d.pricePerPageCents),
            payerEmail = prefs.getString("payerEmail", d.payerEmail) ?: d.payerEmail,
            paymentTimeoutSeconds = prefs.getInt("paymentTimeoutSeconds", d.paymentTimeoutSeconds),
            wifiName = prefs.getString("wifiName", d.wifiName) ?: d.wifiName,
            wifiPassword = prefs.getString("wifiPassword", d.wifiPassword) ?: d.wifiPassword,
        )
    }

    fun save(s: KioskSettings) {
        prefs.edit()
            .putString("kioskName", s.kioskName)
            .putString("adminPin", s.adminPin)
            .putInt("idleTimeoutSeconds", s.idleTimeoutSeconds)
            .putInt("maxCopies", s.maxCopies)
            .putInt("maxItems", s.maxItems)
            .putInt("pricePerPageCents", s.pricePerPageCents)
            .putString("payerEmail", s.payerEmail)
            .putInt("paymentTimeoutSeconds", s.paymentTimeoutSeconds)
            .putString("wifiName", s.wifiName)
            .putString("wifiPassword", s.wifiPassword)
            .apply()
    }
}

/**
 * Keeps the Mercado Pago access token encrypted with a key held in the Android Keystore.
 * The key never leaves this tablet, and the app opts out of backups.
 */
object SecureStore {
    private const val KEY_ALIAS = "printkiosk_token_key"
    private const val PREFS = "kiosk_secure"
    private const val TOKEN = "mercadopago_token"

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return generator.generateKey()
    }

    fun setToken(context: Context, token: String?) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (token.isNullOrBlank()) {
            prefs.edit().remove(TOKEN).apply()
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        val stored = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(encrypted, Base64.NO_WRAP)
        prefs.edit().putString(TOKEN, stored).apply()
    }

    fun getToken(context: Context): String? {
        val stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(TOKEN, null) ?: return null
        return try {
            val (iv, data) = stored.split(":").let {
                Base64.decode(it[0], Base64.NO_WRAP) to Base64.decode(it[1], Base64.NO_WRAP)
            }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(data), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }
}

/** Text for a Wi-Fi QR Code; phone cameras offer to join the network when they read it. */
fun wifiQrPayload(name: String, password: String): String {
    fun escape(value: String) = value
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace(":", "\\:")
        .replace("\"", "\\\"")
    return if (password.isEmpty()) {
        "WIFI:T:nopass;S:${escape(name)};;"
    } else {
        "WIFI:T:WPA;S:${escape(name)};P:${escape(password)};;"
    }
}

object Money {
    private val formatter = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR"))

    fun format(cents: Int): String = formatter.format(cents / 100.0)
}
