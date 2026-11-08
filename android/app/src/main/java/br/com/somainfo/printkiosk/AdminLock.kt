package br.com.somainfo.printkiosk

import android.content.Context
import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * The staff PIN that guards Configurações (Pix token, printer, subscription).
 *
 * - There is no default PIN: the first time Configurações opens, the staff creates one.
 * - Only a salted PBKDF2 hash is kept, in private storage that is excluded from backups.
 * - After 5 wrong tries the gate locks for 1 minute, doubling on each further miss (max 1 hour),
 *   and the lock survives closing the app.
 */
class AdminLock(context: Context) {
    companion object {
        const val MIN_LENGTH = 6
        private const val ITERATIONS = 120_000
        private const val FREE_TRIES = 5

        fun isAcceptable(pin: String): Boolean =
            pin.length in MIN_LENGTH..12 && pin.all { it.isDigit() } && !isTrivial(pin)

        /** Rejects 111111, 123456, 654321 and the like. */
        fun isTrivial(pin: String): Boolean {
            val digits = pin.map { it - '0' }
            if (digits.size < 2) return true
            val steps = digits.zipWithNext { a, b -> b - a }.toSet()
            return steps == setOf(0) || steps == setOf(1) || steps == setOf(-1)
        }

        fun problem(newPin: String, confirm: String): String? = when {
            !isAcceptable(newPin) -> "Use de $MIN_LENGTH a 12 números, sem repetir o mesmo número nem fazer sequências."
            newPin != confirm -> "Os dois PINs não são iguais."
            else -> null
        }

        fun duration(seconds: Int): String =
            if (seconds < 60) "$seconds segundos" else "${(seconds + 59) / 60} minuto(s)"
    }

    sealed interface Result {
        data object Ok : Result
        data class Wrong(val triesLeft: Int) : Result
        data class Locked(val seconds: Int) : Result
    }

    private val prefs = context.getSharedPreferences("kiosk_admin", Context.MODE_PRIVATE)

    val isSet: Boolean get() = prefs.getString("pinHash", null) != null

    /** Moves a PIN chosen in an older version into the hash. The old factory "1234" is not kept. */
    fun migrate(legacyPin: String) {
        if (isSet || legacyPin.length < 4 || legacyPin == "1234" || !legacyPin.all { it.isDigit() }) return
        save(legacyPin)
    }

    fun save(pin: String) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val hash = derive(pin, salt)
        prefs.edit()
            .putString("pinHash", b64(salt) + ":" + b64(hash))
            .remove("failures").remove("lockedUntil")
            .apply()
    }

    private val lockRemainingMillis: Long?
        get() = (prefs.getLong("lockedUntil", 0L) - System.currentTimeMillis()).takeIf { it > 0 }

    fun check(pin: String): Result {
        lockRemainingMillis?.let { return Result.Locked(((it + 999) / 1000).toInt()) }
        val parts = prefs.getString("pinHash", null)?.split(":") ?: return Result.Wrong(0)
        if (parts.size != 2) return Result.Wrong(0)
        val salt = Base64.decode(parts[0], Base64.NO_WRAP)
        val expected = Base64.decode(parts[1], Base64.NO_WRAP)
        if (MessageDigest.isEqual(derive(pin, salt), expected)) {
            prefs.edit().remove("failures").remove("lockedUntil").apply()
            return Result.Ok
        }
        val failures = prefs.getInt("failures", 0) + 1
        prefs.edit().putInt("failures", failures).apply()
        if (failures < FREE_TRIES) return Result.Wrong(FREE_TRIES - failures)
        val seconds = minOf(3600, 60 * (1 shl minOf(failures - FREE_TRIES, 6)))
        prefs.edit().putLong("lockedUntil", System.currentTimeMillis() + seconds * 1000L).apply()
        return Result.Locked(seconds)
    }

    private fun derive(pin: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(pin.toCharArray(), salt, ITERATIONS, 256)
        return try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
}
