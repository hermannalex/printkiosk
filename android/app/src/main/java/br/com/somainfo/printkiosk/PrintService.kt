package br.com.somainfo.printkiosk

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.pdf.PdfRenderer
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.pdf.PrintedPdfDocument
import java.io.File
import java.io.FileOutputStream
import kotlin.math.min

/**
 * Lays out every photo and PDF page of the job, one per sheet, scaled to fit the paper
 * the customer picks in Android's print window. Copies are collated (A, B, A, B).
 */
class KioskPrintAdapter(
    private val context: Context,
    private val items: List<PrintItem>,
    copies: Int,
) : PrintDocumentAdapter() {

    private data class PageRef(val item: PrintItem, val pageIndex: Int)

    private val pages: List<PageRef> = run {
        val oneCopy = items.flatMap { item -> (0 until item.pageCount).map { PageRef(item, it) } }
        List(copies.coerceAtLeast(1)) { oneCopy }.flatten()
    }

    private var attributes: PrintAttributes? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes,
        cancellationSignal: CancellationSignal,
        callback: LayoutResultCallback,
        extras: Bundle?,
    ) {
        if (cancellationSignal.isCanceled) {
            callback.onLayoutCancelled()
            return
        }
        attributes = newAttributes
        val contentType = if (items.all { it.kind == ItemKind.IMAGE }) {
            PrintDocumentInfo.CONTENT_TYPE_PHOTO
        } else {
            PrintDocumentInfo.CONTENT_TYPE_DOCUMENT
        }
        val info = PrintDocumentInfo.Builder("printkiosk.pdf")
            .setContentType(contentType)
            .setPageCount(pages.size)
            .build()
        callback.onLayoutFinished(info, newAttributes != oldAttributes)
    }

    override fun onWrite(
        ranges: Array<out PageRange>,
        destination: ParcelFileDescriptor,
        cancellationSignal: CancellationSignal,
        callback: WriteResultCallback,
    ) {
        val printAttributes = attributes
        if (printAttributes == null) {
            callback.onWriteFailed("Configuração de página ausente.")
            return
        }

        // Rendering many pages takes a while, so it runs off the main thread.
        Thread {
            val document = PrintedPdfDocument(context, printAttributes)
            val renderers = mutableMapOf<File, Pair<ParcelFileDescriptor, PdfRenderer>>()
            try {
                for ((index, ref) in pages.withIndex()) {
                    if (cancellationSignal.isCanceled) {
                        mainHandler.post { callback.onWriteCancelled() }
                        return@Thread
                    }
                    val page = document.startPage(index)
                    drawPage(page.canvas, page.info.contentRect, ref, renderers)
                    document.finishPage(page)
                }
                FileOutputStream(destination.fileDescriptor).use { document.writeTo(it) }
                mainHandler.post { callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES)) }
            } catch (e: Exception) {
                mainHandler.post { callback.onWriteFailed(e.message) }
            } finally {
                renderers.values.forEach { (descriptor, renderer) ->
                    renderer.close()
                    descriptor.close()
                }
                document.close()
            }
        }.start()
    }

    private fun drawPage(
        canvas: Canvas,
        area: Rect,
        ref: PageRef,
        renderers: MutableMap<File, Pair<ParcelFileDescriptor, PdfRenderer>>,
    ) {
        var bitmap: Bitmap = when (ref.item.kind) {
            ItemKind.IMAGE -> ImageUtils.decodeSampled(ref.item.file, 2400)
            ItemKind.PDF -> {
                val (_, renderer) = renderers.getOrPut(ref.item.file) {
                    val descriptor = ParcelFileDescriptor.open(ref.item.file, ParcelFileDescriptor.MODE_READ_ONLY)
                    descriptor to PdfRenderer(descriptor)
                }
                // 2.5 × 72 dpi = 180 dpi: sharp text without running out of memory.
                renderer.openPage(ref.pageIndex).use { page ->
                    ImageUtils.renderPdfPage(page, 2.5f, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                }
            }
        } ?: return

        // Turn landscape photos sideways on portrait paper (and vice versa) so they fill the sheet.
        val pageIsLandscape = area.width() > area.height()
        val imageIsLandscape = bitmap.width > bitmap.height
        if (ref.item.kind == ItemKind.IMAGE && bitmap.width != bitmap.height && pageIsLandscape != imageIsLandscape) {
            bitmap = ImageUtils.rotate(bitmap, 90)
        }

        val scale = min(area.width().toFloat() / bitmap.width, area.height().toFloat() / bitmap.height)
        val width = bitmap.width * scale
        val height = bitmap.height * scale
        val left = area.left + (area.width() - width) / 2f
        val top = area.top + (area.height() - height) / 2f
        canvas.drawBitmap(bitmap, null, RectF(left, top, left + width, top + height), Paint(Paint.FILTER_BITMAP_FLAG))
        bitmap.recycle()
    }
}

/** One-page test print for the staff settings. Android remembers the printer picked here. */
class TestPageAdapter(private val context: Context, private val kioskName: String) : PrintDocumentAdapter() {
    private var attributes: PrintAttributes? = null

    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes,
        cancellationSignal: CancellationSignal,
        callback: LayoutResultCallback,
        extras: Bundle?,
    ) {
        if (cancellationSignal.isCanceled) {
            callback.onLayoutCancelled()
            return
        }
        attributes = newAttributes
        val info = PrintDocumentInfo.Builder("printkiosk-teste.pdf")
            .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
            .setPageCount(1)
            .build()
        callback.onLayoutFinished(info, newAttributes != oldAttributes)
    }

    override fun onWrite(
        ranges: Array<out PageRange>,
        destination: ParcelFileDescriptor,
        cancellationSignal: CancellationSignal,
        callback: WriteResultCallback,
    ) {
        val printAttributes = attributes ?: return callback.onWriteFailed("Configuração de página ausente.")
        val document = PrintedPdfDocument(context, printAttributes)
        try {
            val page = document.startPage(0)
            val area = page.info.contentRect
            val title = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 28f; isFakeBoldText = true; color = Color.BLACK }
            val body = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 14f; color = Color.DKGRAY }
            val left = area.left + 36f
            var y = area.top + 72f
            page.canvas.drawText("Página de teste", left, y, title)
            y += 36f
            page.canvas.drawText(kioskName, left, y, body)
            y += 22f
            page.canvas.drawText("Se você está lendo isto, a impressora está pronta para o PrintKiosk.", left, y, body)
            document.finishPage(page)
            FileOutputStream(destination.fileDescriptor).use { document.writeTo(it) }
            callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
        } catch (e: Exception) {
            callback.onWriteFailed(e.message)
        } finally {
            document.close()
        }
    }
}
