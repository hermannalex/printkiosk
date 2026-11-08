package br.com.somainfo.quioco

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import androidx.compose.ui.graphics.asImageBitmap
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import kotlin.math.max

object ImageUtils {
    /** Decodes a photo no larger than about [maxSide] pixels, upright according to its EXIF data. */
    fun decodeSampled(file: File, maxSide: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2

        val bitmap = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: return null

        val degrees = try {
            when (ExifInterface(file.path).getAttributeInt(
                ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL
            )) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }
        } catch (e: Exception) {
            0
        }
        return if (degrees == 0) bitmap else rotate(bitmap, degrees)
    }

    fun rotate(bitmap: Bitmap, degrees: Int): Bitmap {
        val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
        val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        if (rotated !== bitmap) bitmap.recycle()
        return rotated
    }

    /** Renders one PDF page on a white background. [scale] 1 = 72 dpi. */
    fun renderPdfPage(page: PdfRenderer.Page, scale: Float, mode: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(
            max(1, (page.width * scale).toInt()),
            max(1, (page.height * scale).toInt()),
            Bitmap.Config.ARGB_8888,
        )
        bitmap.eraseColor(Color.WHITE)
        page.render(bitmap, null, null, mode)
        return bitmap
    }
}

/** Copies a picked photo or PDF into the app's cache and reads what the screens need. */
object ItemLoader {
    sealed interface Result {
        data class Success(val item: PrintItem) : Result
        data class Failure(val message: String) : Result
    }

    fun jobsDir(context: Context): File = File(context.cacheDir, "jobs").apply { mkdirs() }

    suspend fun load(context: Context, uri: Uri, kind: ItemKind, fallbackName: String): Result =
        withContext(Dispatchers.IO) {
            val displayName = queryName(context, uri)
            val label = displayName ?: "o arquivo"
            val extension = if (kind == ItemKind.PDF) "pdf" else "img"
            val file = File(jobsDir(context), "${UUID.randomUUID()}.$extension")

            val copied = try {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    file.outputStream().use { output -> input.copyTo(output) }
                    true
                } ?: false
            } catch (e: Exception) {
                false
            }
            if (!copied) {
                file.delete()
                return@withContext Result.Failure("Não foi possível abrir $label.")
            }

            when (kind) {
                ItemKind.IMAGE -> loadImage(file, fallbackName)
                ItemKind.PDF -> loadPdf(file, displayName?.substringBeforeLast('.') ?: fallbackName)
            }
        }

    /** Reads a file that is already in the jobs folder, such as one sent from a phone. */
    suspend fun loadLocal(file: File, kind: ItemKind, name: String): Result = withContext(Dispatchers.IO) {
        when (kind) {
            ItemKind.IMAGE -> loadImage(file, name)
            ItemKind.PDF -> loadPdf(file, name)
        }
    }

    private fun loadImage(file: File, name: String): Result {
        val thumbnail = ImageUtils.decodeSampled(file, 400)
        if (thumbnail == null) {
            file.delete()
            return Result.Failure("Uma foto não pôde ser carregada. Tente outra foto.")
        }
        return Result.Success(
            PrintItem(file = file, kind = ItemKind.IMAGE, name = name, pageCount = 1, thumbnail = thumbnail.asImageBitmap())
        )
    }

    private fun loadPdf(file: File, name: String): Result {
        return try {
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
                PdfRenderer(descriptor).use { renderer ->
                    if (renderer.pageCount == 0) {
                        file.delete()
                        Result.Failure("$name não tem páginas.")
                    } else {
                        val thumbnail = renderer.openPage(0).use { page ->
                            val scale = 300f / max(page.width, page.height)
                            ImageUtils.renderPdfPage(page, scale, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        }
                        Result.Success(
                            PrintItem(
                                file = file,
                                kind = ItemKind.PDF,
                                name = name,
                                pageCount = renderer.pageCount,
                                thumbnail = thumbnail.asImageBitmap(),
                            )
                        )
                    }
                }
            }
        } catch (e: SecurityException) {
            file.delete()
            Result.Failure("$name tem senha. Remova a senha e tente de novo.")
        } catch (e: Exception) {
            file.delete()
            Result.Failure("$name não é um PDF válido.")
        }
    }

    private fun queryName(context: Context, uri: Uri): String? = try {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
    } catch (e: Exception) {
        null
    }
}
