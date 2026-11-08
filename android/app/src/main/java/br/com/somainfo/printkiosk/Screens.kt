package br.com.somainfo.printkiosk

import android.graphics.Bitmap
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import kotlinx.coroutines.delay

// region Root

@Composable
fun KioskApp(vm: KioskViewModel, onPinScreen: () -> Unit, onUnpinScreen: () -> Unit) {
    // The back button does nothing in the kiosk; customers move with the on-screen buttons.
    BackHandler(enabled = true) { }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when (val step = vm.step) {
            KioskStep.Welcome -> WelcomeScreen(vm)
            KioskStep.Select -> SelectScreen(vm)
            KioskStep.Review -> ReviewScreen(vm)
            KioskStep.Payment -> PaymentScreen(vm)
            KioskStep.Printing -> PrintingScreen(vm)
            is KioskStep.Finished -> FinishedScreen(vm, step)
        }
    }

    if (vm.phoneUpload != null) {
        PhoneUploadDialog(vm)
    }

    if (vm.showAdmin) {
        AdminScreen(vm = vm, onPinScreen = onPinScreen, onUnpinScreen = onUnpinScreen, onClose = { vm.showAdmin = false })
    }

    vm.notice?.let { message ->
        AlertDialog(
            onDismissRequest = { vm.notice = null },
            confirmButton = { TextButton(onClick = { vm.notice = null }) { Text("OK") } },
            title = { Text("Atenção") },
            text = { Text(message) },
        )
    }
}

// endregion

// region Welcome

@Composable
private fun WelcomeScreen(vm: KioskViewModel) {
    val wifiName = vm.settings.wifiName.trim()

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically),
    ) {
        Icon(
            imageVector = Icons.Filled.Print,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.primary,
        )

        // Staff settings (Pix, Wi-Fi, limits, test print). Protected by the staff PIN.
        FilledTonalButton(onClick = { vm.showAdmin = true }) {
            Icon(Icons.Filled.Settings, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Configurações", style = MaterialTheme.typography.titleMedium)
        }

        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "XEROX",
                fontSize = 120.sp,
                lineHeight = 124.sp,
                fontWeight = FontWeight.Black,
                letterSpacing = 6.sp,
                maxLines = 1,
            )
            Text(
                "AUTO SERVIÇO",
                fontSize = 56.sp,
                lineHeight = 60.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 2.sp,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 1,
            )
        }

        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                if (vm.requiresPayment) "Imprima aqui por ${Money.format(vm.settings.pricePerPageCents)}" else "Imprima aqui",
                fontSize = 42.sp,
                lineHeight = 48.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            Text(
                if (vm.requiresPayment) "por página · fotos e PDFs · pagamento via Pix"
                else "Fotos e PDFs, do seu celular ou deste tablet",
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }

        PrimaryButton(text = "Toque para começar", onClick = { vm.start() })

        if (vm.requiresPayment && !vm.isPixConfigured) {
            WarningText("Pagamento Pix não configurado. Atendente: toque em Configurações.")
        }

        LicenseBanner(vm.license)

        if (wifiName.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            WifiCard(name = wifiName, password = vm.settings.wifiPassword)
        }
    }
}

/** Demo counter or "subscription needed"; nothing while the subscription is active. */
@Composable
private fun LicenseBanner(license: LicenseState) {
    val (text, color) = when (license) {
        is LicenseState.Active -> return
        is LicenseState.Demo -> (if (license.remaining == 1) "Modo demonstração · 1 impressão restante"
            else "Modo demonstração · ${license.remaining} impressões restantes") to KioskOrange
        is LicenseState.Expired -> "Assinatura vencida. Atendente: toque em Configurações." to MaterialTheme.colorScheme.error
        LicenseState.DemoOver -> "Demonstração encerrada. Atendente: toque em Configurações para assinar." to MaterialTheme.colorScheme.error
    }
    Surface(shape = RoundedCornerShape(999.dp), color = color.copy(alpha = 0.12f)) {
        Text(
            text,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = color,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
        )
    }
}

/** The store's Wi-Fi, so customers can connect their phone by pointing the camera. */
@Composable
private fun WifiCard(name: String, password: String) {
    Card(
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier.padding(20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            QrImage(payload = wifiQrPayload(name, password), modifier = Modifier.size(170.dp))
            Column(modifier = Modifier.widthIn(max = 360.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Filled.Wifi, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text("Wi-Fi grátis da loja", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                Text(
                    "Aponte a câmera do celular para o código e toque para conectar.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text("Rede: $name", style = MaterialTheme.typography.titleMedium)
                if (password.isNotEmpty()) {
                    Text("Senha: $password", style = MaterialTheme.typography.titleMedium)
                }
            }
        }
    }
}

// endregion

// region Select

@Composable
private fun SelectScreen(vm: KioskViewModel) {
    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris ->
        vm.addImages(uris)
    }
    val pdfPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        vm.addPdfs(uris)
    }
    val canAdd = vm.remainingSlots > 0

    ScreenColumn {
        Header(
            title = "Escolha o que imprimir",
            subtitle = "${vm.items.size} de ${vm.settings.maxItems} itens adicionados",
        )

        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            SourceTile(
                title = "Fotos",
                icon = Icons.Filled.PhotoLibrary,
                enabled = canAdd,
                modifier = Modifier.weight(1f),
                onClick = {
                    photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                },
            )
            SourceTile(
                title = "Arquivos PDF",
                icon = Icons.Filled.PictureAsPdf,
                enabled = canAdd,
                modifier = Modifier.weight(1f),
                onClick = { pdfPicker.launch(arrayOf("application/pdf")) },
            )
            SourceTile(
                title = "Do celular",
                icon = Icons.Filled.Smartphone,
                enabled = canAdd,
                modifier = Modifier.weight(1f),
                onClick = { vm.openPhoneUpload() },
            )
        }

        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            if (vm.items.isEmpty()) {
                Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(
                        Icons.Filled.Inbox,
                        contentDescription = null,
                        modifier = Modifier.size(56.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Nada adicionado ainda. Escolha fotos ou arquivos PDF acima.",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(170.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    items(vm.items, key = { it.id }) { item ->
                        ItemTile(item = item, onRemove = { vm.remove(item) })
                    }
                }
            }

            if (vm.isLoading) {
                Surface(
                    modifier = Modifier.align(Alignment.Center),
                    shape = RoundedCornerShape(16.dp),
                    tonalElevation = 6.dp,
                    shadowElevation = 6.dp,
                ) {
                    Row(
                        modifier = Modifier.padding(28.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        CircularProgressIndicator()
                        Text("Carregando…", style = MaterialTheme.typography.titleLarge)
                    }
                }
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            SecondaryButton(text = "Recomeçar", onClick = { vm.reset() })
            Spacer(Modifier.weight(1f))
            PrimaryButton(text = "Continuar", enabled = vm.items.isNotEmpty() && !vm.isLoading, onClick = { vm.goToReview() })
        }
    }
}

@Composable
private fun SourceTile(
    title: String,
    icon: ImageVector,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 22.dp, horizontal = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(40.dp), tint = MaterialTheme.colorScheme.primary)
            Text(
                title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.primary,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun ItemTile(item: PrintItem, onRemove: (() -> Unit)? = null) {
    Box {
        Card(
            shape = RoundedCornerShape(14.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(160.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                    contentAlignment = Alignment.Center,
                ) {
                    val thumbnail = item.thumbnail
                    if (thumbnail != null) {
                        Image(
                            bitmap = thumbnail,
                            contentDescription = item.name,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize(),
                        )
                    } else {
                        Icon(Icons.Filled.PictureAsPdf, contentDescription = null, modifier = Modifier.size(48.dp))
                    }
                }
                Text(item.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    if (item.pageCount == 1) "1 página" else "${item.pageCount} páginas",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (onRemove != null) {
            IconButton(onClick = onRemove, modifier = Modifier.align(Alignment.TopEnd)) {
                Icon(
                    Icons.Filled.Cancel,
                    contentDescription = "Remover ${item.name}",
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(34.dp).background(Color.White, CircleShape),
                )
            }
        }
    }
}

// endregion

// region Review

@Composable
private fun ReviewScreen(vm: KioskViewModel) {
    ScreenColumn {
        Header(
            title = "Confira sua impressão",
            subtitle = "Depois, escolha a impressora na janela de impressão e toque em Imprimir.",
        )

        LazyVerticalGrid(
            columns = GridCells.Adaptive(140.dp),
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            items(vm.items, key = { it.id }) { ItemTile(item = it) }
        }

        Card(
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(24.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                Text("Cópias", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                FilledIconButton(onClick = { vm.removeCopy() }, enabled = vm.copies > 1, modifier = Modifier.size(56.dp)) {
                    Icon(Icons.Filled.Remove, contentDescription = "Menos cópias")
                }
                Text(
                    "${vm.copies}",
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.widthIn(min = 56.dp),
                )
                FilledIconButton(
                    onClick = { vm.addCopy() },
                    enabled = vm.copies < vm.settings.maxCopies,
                    modifier = Modifier.size(56.dp),
                ) {
                    Icon(Icons.Filled.Add, contentDescription = "Mais cópias")
                }
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        if (vm.totalPages == 1) "1 página" else "${vm.totalPages} páginas",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (vm.requiresPayment) {
                        Text(
                            Money.format(vm.amountCents),
                            style = MaterialTheme.typography.headlineLarge,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            SecondaryButton(text = "Voltar", onClick = { vm.goToSelect() })
            Spacer(Modifier.weight(1f))
            if (vm.requiresPayment && vm.paidPaymentId == null) {
                PrimaryButton(text = "Pagar com Pix", icon = Icons.Filled.QrCode2, onClick = { vm.checkout() })
            } else {
                PrimaryButton(text = "Imprimir", icon = Icons.Filled.Print, onClick = { vm.checkout() })
            }
        }
    }
}

// endregion

// region Payment

@Composable
private fun PaymentScreen(vm: KioskViewModel) {
    Box(modifier = Modifier.fillMaxSize().padding(48.dp), contentAlignment = Alignment.Center) {
        when (val state = vm.paymentState) {
            PaymentState.Preparing -> Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                CircularProgressIndicator(modifier = Modifier.size(72.dp))
                Text("Preparando o pagamento…", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            }

            // Side by side on a landscape tablet, stacked in portrait.
            is PaymentState.Waiting -> BoxWithConstraints(contentAlignment = Alignment.Center) {
                if (maxWidth > 900.dp) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(56.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        QrImage(payload = state.charge.qrCode, modifier = Modifier.size(380.dp))
                        PaymentInstructions(vm, state.charge)
                    }
                } else {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(32.dp),
                    ) {
                        QrImage(payload = state.charge.qrCode, modifier = Modifier.size(340.dp))
                        PaymentInstructions(vm, state.charge)
                    }
                }
            }

            PaymentState.Expired -> MessageBlock(
                icon = Icons.Filled.Schedule,
                iconTint = KioskOrange,
                title = "O QR Code expirou",
                message = "Nenhum valor foi cobrado. Gere um novo QR Code para tentar de novo.",
            ) {
                SecondaryButton(text = "Recomeçar", onClick = { vm.reset() })
                PrimaryButton(text = "Gerar novo QR Code", onClick = { vm.checkout() })
            }

            is PaymentState.Failed -> MessageBlock(
                icon = Icons.Filled.Warning,
                iconTint = KioskOrange,
                title = "Não foi possível concluir o pagamento",
                message = state.message,
            ) {
                SecondaryButton(text = "Voltar", onClick = { vm.goToReview() })
                PrimaryButton(text = "Tentar de novo", onClick = { vm.checkout() })
            }
        }
    }
}

@Composable
private fun PaymentInstructions(vm: KioskViewModel, charge: PixCharge) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(charge.id) {
        while (true) {
            delay(1_000)
            now = System.currentTimeMillis()
        }
    }

    Column(modifier = Modifier.widthIn(max = 440.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Text("Pague com Pix", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text(
            Money.format(charge.amountCents),
            style = MaterialTheme.typography.displayMedium,
            fontWeight = FontWeight.ExtraBold,
            color = MaterialTheme.colorScheme.primary,
        )
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("1. Abra o app do seu banco", style = MaterialTheme.typography.titleLarge)
            Text("2. Escolha Pix › Pagar com QR Code", style = MaterialTheme.typography.titleLarge)
            Text("3. Aponte a câmera e confirme", style = MaterialTheme.typography.titleLarge)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 3.dp)
            val remaining = ((vm.paymentDeadline ?: now) - now).coerceAtLeast(0) / 1_000
            Text(
                "Aguardando pagamento · %d:%02d".format(remaining / 60, remaining % 60),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            "A impressão começa assim que o pagamento for confirmado.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SecondaryButton(text = "Cancelar", onClick = { vm.cancelPayment() })
    }
}

/** Renders any text (a Pix payload, a link, a Wi-Fi network) as a QR Code on the tablet. */
@Composable
private fun QrImage(payload: String, modifier: Modifier = Modifier) {
    val bitmap: ImageBitmap? = remember(payload) { renderQrCode(payload) }
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(24.dp))
            .background(Color.White)
            .padding(20.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap,
                contentDescription = "QR Code",
                filterQuality = FilterQuality.None,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Icon(Icons.Filled.QrCode2, contentDescription = null, modifier = Modifier.fillMaxSize())
        }
    }
}

private fun renderQrCode(payload: String): ImageBitmap? = try {
    val hints = mapOf(
        EncodeHintType.MARGIN to 1,
        EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
        EncodeHintType.CHARACTER_SET to "UTF-8",
    )
    val matrix = QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, 0, 0, hints)
    val pixels = IntArray(matrix.width * matrix.height) { index ->
        val x = index % matrix.width
        val y = index / matrix.width
        if (matrix.get(x, y)) android.graphics.Color.BLACK else android.graphics.Color.WHITE
    }
    Bitmap.createBitmap(pixels, matrix.width, matrix.height, Bitmap.Config.ARGB_8888).asImageBitmap()
} catch (e: Exception) {
    null
}

// endregion

// region Printing and result

@Composable
private fun PrintingScreen(vm: KioskViewModel) {
    Column(
        modifier = Modifier.fillMaxSize().padding(48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically),
    ) {
        CircularProgressIndicator(modifier = Modifier.size(72.dp))
        if (vm.paidPaymentId != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Filled.Verified, contentDescription = null, tint = KioskGreen)
                Text("Pagamento confirmado", style = MaterialTheme.typography.titleLarge, color = KioskGreen)
            }
        }
        Text("Preparando a impressão…", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(
            "Na janela que abrir, confira a impressora e toque no botão de imprimir.",
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun FinishedScreen(vm: KioskViewModel, result: KioskStep.Finished) {
    LaunchedEffect(result) {
        if (result.success) {
            delay(12_000)
            vm.reset()
        }
    }

    Box(modifier = Modifier.fillMaxSize().padding(48.dp), contentAlignment = Alignment.Center) {
        MessageBlock(
            icon = if (result.success) Icons.Filled.CheckCircle else Icons.Filled.Warning,
            iconTint = if (result.success) KioskGreen else KioskOrange,
            title = if (result.success) "Enviado para a impressora" else "Não foi possível imprimir",
            message = if (result.success) {
                "Retire suas páginas na impressora. Esta tela volta ao início em alguns segundos."
            } else {
                result.message ?: "Algo deu errado. Tente de novo."
            },
            footer = {
                val paidId = vm.paidPaymentId
                if (!result.success && paidId != null) {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                        Text(
                            "Seu pagamento foi recebido e você não será cobrado de novo ao tentar outra vez. " +
                                "Se a impressão não sair, mostre este código a um atendente: $paidId",
                            style = MaterialTheme.typography.titleMedium,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(20.dp),
                        )
                    }
                }
            },
        ) {
            if (result.success) {
                PrimaryButton(text = "Concluir", onClick = { vm.reset() })
            } else {
                SecondaryButton(text = "Recomeçar", onClick = { vm.reset() })
                PrimaryButton(text = "Tentar de novo", onClick = { vm.sendToPrinter() })
            }
        }
    }
}

// endregion

// region Files from the phone

@Composable
private fun PhoneUploadDialog(vm: KioskViewModel) {
    val state = vm.phoneUpload ?: return
    val wifiName = vm.settings.wifiName.trim()

    Dialog(
        onDismissRequest = { vm.closePhoneUpload() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            shape = RoundedCornerShape(28.dp),
            color = MaterialTheme.colorScheme.background,
            modifier = Modifier.padding(32.dp).widthIn(max = 880.dp),
        ) {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()).padding(32.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Envie do seu celular", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
                    Text(
                        "Fotos e PDFs chegam aqui pela rede Wi-Fi da loja, sem cabo e sem aplicativo.",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                when (state) {
                    PhoneUploadState.Starting -> Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        CircularProgressIndicator()
                        Text("Preparando…", style = MaterialTheme.typography.titleLarge)
                    }

                    is PhoneUploadState.Unavailable -> WarningText(state.message)

                    is PhoneUploadState.Ready -> {
                        Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                            if (wifiName.isNotEmpty()) {
                                QrStep(
                                    number = 1,
                                    title = "Entre no Wi-Fi",
                                    caption = "Rede $wifiName",
                                    payload = wifiQrPayload(wifiName, vm.settings.wifiPassword),
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            QrStep(
                                number = if (wifiName.isNotEmpty()) 2 else 1,
                                title = "Abra a página de envio",
                                caption = "Aponte a câmera do celular para o código",
                                payload = state.url,
                                modifier = Modifier.weight(1f),
                            )
                        }
                        if (wifiName.isEmpty()) {
                            Text(
                                "O celular precisa estar no mesmo Wi-Fi deste tablet.",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Text(
                            "No celular, toque em Escolher fotos ou PDF. Os arquivos aparecem aqui na hora.",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            "Endereço: ${state.url}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    val count = vm.phoneReceivedCount
                    if (count > 0) {
                        Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = KioskGreen)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            if (count == 1) "1 arquivo recebido" else "$count arquivos recebidos",
                            style = MaterialTheme.typography.titleLarge,
                            color = KioskGreen,
                            fontWeight = FontWeight.SemiBold,
                        )
                    } else if (state is PhoneUploadState.Ready) {
                        Text(
                            "Aguardando arquivos…",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    PrimaryButton(text = "Concluir", onClick = { vm.closePhoneUpload() })
                }
            }
        }
    }
}

@Composable
private fun QrStep(number: Int, title: String, caption: String, payload: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("$number. $title", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        QrImage(payload = payload, modifier = Modifier.size(260.dp))
        Text(
            caption,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

// endregion

// region Shared components

@Composable
private fun ScreenColumn(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(40.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
        content = content,
    )
}

@Composable
private fun Header(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text(subtitle, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun MessageBlock(
    icon: ImageVector,
    iconTint: Color,
    title: String,
    message: String,
    footer: @Composable () -> Unit = {},
    actions: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier.widthIn(max = 640.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(112.dp))
        Text(title, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Text(
            message,
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        footer()
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) { actions() }
    }
}

@Composable
private fun WarningText(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = KioskOrange)
        Text(text, style = MaterialTheme.typography.titleMedium, color = KioskOrange, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun PrimaryButton(text: String, icon: ImageVector? = null, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        contentPadding = PaddingValues(horizontal = 40.dp, vertical = 18.dp),
        modifier = Modifier.heightIn(min = 64.dp),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null)
            Spacer(Modifier.width(12.dp))
        }
        Text(text, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit) {
    FilledTonalButton(
        onClick = onClick,
        shape = CircleShape,
        contentPadding = PaddingValues(horizontal = 32.dp, vertical = 16.dp),
        modifier = Modifier.heightIn(min = 60.dp),
    ) {
        Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
}

// endregion
