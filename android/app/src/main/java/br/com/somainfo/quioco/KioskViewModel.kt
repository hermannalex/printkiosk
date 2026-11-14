package br.com.somainfo.quioco

import android.app.Application
import android.net.Uri
import android.print.PrintDocumentAdapter
import android.print.PrintJob
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.security.SecureRandom

class KioskViewModel(application: Application) : AndroidViewModel(application) {
    private val app get() = getApplication<Application>()
    private val settingsStore = SettingsStore(application)
    private val licenseStore = LicenseStore(application)

    var settings by mutableStateOf(settingsStore.load())
        private set
    var step by mutableStateOf<KioskStep>(KioskStep.Welcome)
        private set
    val items = mutableStateListOf<PrintItem>()
    var copies by mutableIntStateOf(1)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var notice by mutableStateOf<String?>(null)
    var showAdmin by mutableStateOf(false)

    // Payment
    var paymentState by mutableStateOf<PaymentState>(PaymentState.Preparing)
        private set
    /** When the QR Code stops being valid, in epoch milliseconds. */
    var paymentDeadline by mutableStateOf<Long?>(null)
        private set
    /** Set once the customer has paid, so a retry after a printer error never charges twice. */
    var paid by mutableStateOf<Paid?>(null)
        private set
    val paidPaymentId: String? get() = paid?.id
    /** At least one copy of a paid job went to the printer (else an unused voucher is given back). */
    private var paidPrinted = false
    /** Voucher balance after paying, shown on the finish screen. */
    var voucherBalance by mutableStateOf<Int?>(null)
        private set
    var voucherError by mutableStateOf<String?>(null)
        private set
    var voucherBusy by mutableStateOf(false)
        private set
    private val pointPrefs = application.getSharedPreferences("kiosk_point", android.content.Context.MODE_PRIVATE)
    /** Mercado Pago Point terminal in PDV mode, or null. */
    var pointTerminal by mutableStateOf(pointPrefs.getString("terminal", null))
        private set
    private var activeOrder: String? = null
    private var lastMethod = "pix"
    var tokenSuffix by mutableStateOf(SecureStore.getToken(application)?.takeLast(4))
        private set

    // Files sent from the customer's phone
    var phoneUpload by mutableStateOf<PhoneUploadState?>(null)
        private set
    var phoneReceivedCount by mutableIntStateOf(0)
        private set
    private var uploadServer: UploadServer? = null

    // Subscription / demo
    var license by mutableStateOf(licenseStore.state())
        private set
    val storeCode: String = LicenseCodec.storeCode(licenseStore.storeId)
    /** The kiosk always prints; after the free trial (or a lapsed subscription) pages carry the watermark. */
    val canPrint: Boolean get() = true
    val watermarked: Boolean get() = !Edition.FREE && (license is LicenseState.Expired || license is LicenseState.DemoOver)

    // Staff PIN (hash only, see AdminLock)
    val adminLock = AdminLock(application)

    // Online dashboard
    val cloud = CloudSync(application)
    var lastSync by mutableStateOf(cloud.lastSync)
        private set
    var syncError by mutableStateOf<String?>(null)
        private set

    private var activeCharge: PixCharge? = null
    private var paymentJob: Job? = null
    private var lastInteraction = System.currentTimeMillis()

    /** Set by MainActivity: shows Android's print window for an adapter. */
    var printLauncher: ((PrintDocumentAdapter, String) -> PrintJob?)? = null

    init {
        ItemLoader.jobsDir(application).deleteRecursively()
        viewModelScope.launch {
            while (isActive) {
                delay(5_000)
                checkIdle()
            }
        }
        viewModelScope.launch {
            while (isActive) {
                syncWithDashboard()
                delay(30 * 60_000L)
            }
        }
    }

    /** Moves a PIN saved in plain text by an older version into the hash, then clears it. */
    fun migrateLegacyPin() {
        adminLock.migrate(settings.adminPin)
        if (settings.adminPin.isNotEmpty()) updateSettings { it.copy(adminPin = "") }
    }

    // region Online dashboard

    /** Sends the print history and applies a newer activation code from the dashboard. */
    suspend fun syncWithDashboard() {
        if (Edition.FREE) return
        refreshLicense()
        val version = runCatching {
            app.packageManager.getPackageInfo(app.packageName, 0).versionName
        }.getOrNull() ?: ""
        val response = cloud.sync(storeCode, license, version, settings.toRemoteJson()) ?: return
        if (!response.ok) {
            syncError = response.error
            return
        }
        syncError = null
        lastSync = cloud.lastSync
        val remote = response.config
        if (remote != null && response.configVersion > cloud.appliedConfigVersion) {
            updateSettings { it.applyRemote(remote) }
            cloud.appliedConfigVersion = response.configVersion
            // Tell the dashboard right away that the new settings are in use.
            viewModelScope.launch { syncWithDashboard() }
        }
        val code = response.activationCode ?: return
        val until = LicenseCodec.verify(code, licenseStore.storeId) ?: return
        val current = (license as? LicenseState.Active)?.let { LicenseCodec.dayNumber(it.until) }
        if (current == null || until > current) {
            licenseStore.activate(code)
            refreshLicense()
        }
    }

    fun syncNow() {
        viewModelScope.launch { syncWithDashboard() }
    }

    private fun recordPrint(success: Boolean, demo: Boolean) {
        if (Edition.FREE) return // imprime-free has no dashboard
        val pages = items.sumOf { it.pageCount }
        val payment = paid?.takeIf { success }
        cloud.record(
            PrintJobRecord(
                id = java.util.UUID.randomUUID().toString(),
                printedAt = CloudSync.isoNow(),
                items = items.size,
                pages = pages,
                copies = copies,
                totalPages = pages * copies,
                amountCents = payment?.amountCents ?: 0,
                paidWithPix = payment?.method == "pix",
                pixPaymentId = payment?.takeIf { it.method == "pix" }?.id,
                success = success,
                demo = demo,
                paymentMethod = payment?.method,
                paymentId = payment?.id,
            )
        )
        syncNow()
    }

    // endregion

    // region Derived values

    val totalPages: Int get() = items.sumOf { it.pageCount } * copies
    val amountCents: Int get() = if (Edition.FREE) 0 else totalPages * settings.pricePerPageCents
    /** imprime-free never charges, whatever price was saved. */
    val requiresPayment: Boolean get() = !Edition.FREE && settings.pricePerPageCents > 0
    val remainingSlots: Int get() = (settings.maxItems - items.size).coerceAtLeast(0)
    val isPixConfigured: Boolean get() = settings.payerEmail.contains("@") && tokenSuffix != null
    val isCardConfigured: Boolean get() = tokenSuffix != null && pointTerminal != null
    private val token: String? get() = SecureStore.getToken(app)

    // endregion

    // region Session flow

    fun registerInteraction() {
        lastInteraction = System.currentTimeMillis()
    }

    fun start() {
        registerInteraction()
        refreshLicense()
        if (!canPrint) {
            notice = blockedMessage()
            return
        }
        step = KioskStep.Select
    }

    fun goToSelect() { step = KioskStep.Select }
    fun goToReview() { step = KioskStep.Review }

    fun addCopy() { if (copies < settings.maxCopies) copies++ }
    fun removeCopy() { if (copies > 1) copies-- }

    fun reset() {
        closePhoneUpload()
        paymentJob?.cancel()
        paymentJob = null
        val charge = activeCharge
        val currentToken = token
        if (charge != null && currentToken != null) {
            viewModelScope.launch {
                try { PixService(currentToken).cancel(charge.id) } catch (e: PixException) { }
            }
        }
        activeCharge = null
        val order = activeOrder
        if (order != null && currentToken != null) {
            viewModelScope.launch { PointService(currentToken).cancel(order) }
        }
        activeOrder = null
        // A voucher that paid for a print that never went out gets its value back.
        val voucher = paid?.takeIf { it.method == "voucher" && !paidPrinted }
        if (voucher != null) {
            viewModelScope.launch { cloud.voucher(storeCode, "refund", null, 0, voucher.id) }
        }
        paymentDeadline = null
        paid = null
        paidPrinted = false
        voucherBalance = null
        voucherError = null
        paymentState = PaymentState.Preparing

        items.clear()
        copies = 1
        notice = null
        step = KioskStep.Welcome
        ItemLoader.jobsDir(app).deleteRecursively()
    }

    private fun checkIdle() {
        when (step) {
            KioskStep.Welcome, KioskStep.Printing -> return
            KioskStep.Payment -> {
                // Never reset while a customer may be paying on their phone.
                if (paymentState is PaymentState.Preparing || paymentState is PaymentState.Waiting ||
                    paymentState is PaymentState.CardWaiting) return
            }
            else -> Unit
        }
        if (showAdmin) return
        // Give customers more time while they pick files on their phone.
        val timeout = if (phoneUpload != null) maxOf(settings.idleTimeoutSeconds, 300) else settings.idleTimeoutSeconds
        if (System.currentTimeMillis() - lastInteraction > timeout * 1_000L) reset()
    }

    // endregion

    // region Adding and removing items

    fun remove(item: PrintItem) {
        items.remove(item)
        item.file.delete()
    }

    fun addImages(uris: List<Uri>) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            isLoading = true
            val accepted = uris.take(remainingSlots)
            val skipped = uris.size - accepted.size
            var failed = 0
            for (uri in accepted) {
                when (val result = ItemLoader.load(app, uri, ItemKind.IMAGE, "Foto ${items.size + 1}")) {
                    is ItemLoader.Result.Success -> items.add(result.item)
                    is ItemLoader.Result.Failure -> failed++
                }
            }
            isLoading = false
            when {
                failed == 1 -> notice = "1 foto não pôde ser carregada."
                failed > 1 -> notice = "$failed fotos não puderam ser carregadas."
                skipped > 0 -> notice = "Você atingiu o limite de ${settings.maxItems} itens por impressão. " +
                    "$skipped foto(s) ficaram de fora."
            }
        }
    }

    fun addPdfs(uris: List<Uri>) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            isLoading = true
            val problems = mutableListOf<String>()
            for (uri in uris) {
                if (remainingSlots == 0) {
                    problems.add("Você atingiu o limite de ${settings.maxItems} itens por impressão.")
                    break
                }
                when (val result = ItemLoader.load(app, uri, ItemKind.PDF, "Documento ${items.size + 1}")) {
                    is ItemLoader.Result.Success -> items.add(result.item)
                    is ItemLoader.Result.Failure -> problems.add(result.message)
                }
            }
            isLoading = false
            if (problems.isNotEmpty()) notice = problems.joinToString("\n")
        }
    }

    // endregion

    // region Files from the customer's phone

    /** Opens the "Do celular" panel and starts the upload page on the store's Wi-Fi. */
    fun openPhoneUpload() {
        registerInteraction()
        closePhoneUpload()
        phoneReceivedCount = 0
        phoneUpload = PhoneUploadState.Starting

        viewModelScope.launch {
            val ip = withContext(Dispatchers.IO) { UploadServer.localIpAddress() }
            if (ip == null) {
                phoneUpload = PhoneUploadState.Unavailable(
                    "Este tablet não está conectado a uma rede Wi-Fi. Conecte o tablet ao Wi-Fi da loja e tente de novo."
                )
                return@launch
            }
            val token = randomToken()
            val server = UploadServer(token, uploadPage(), ItemLoader.jobsDir(app), ::receiveUpload)
            val port = withContext(Dispatchers.IO) {
                try { server.start() } catch (e: IOException) { null }
            }
            if (port == null) {
                phoneUpload = PhoneUploadState.Unavailable("Não foi possível abrir o recebimento de arquivos. Tente de novo.")
                return@launch
            }
            if (phoneUpload != PhoneUploadState.Starting) {
                server.stop() // The panel was closed meanwhile.
                return@launch
            }
            uploadServer = server
            phoneUpload = PhoneUploadState.Ready("http://$ip:$port/u/$token")
        }
    }

    fun closePhoneUpload() {
        uploadServer?.stop()
        uploadServer = null
        phoneUpload = null
    }

    /** Called on the server's thread for each file the phone sends. */
    private fun receiveUpload(file: File, name: String, mimeType: String): UploadResult = runBlocking(Dispatchers.Main) {
        registerInteraction()
        if (uploadServer == null) {
            file.delete()
            return@runBlocking UploadResult(false, "O recebimento foi encerrado no quiosque.")
        }
        if (remainingSlots == 0) {
            file.delete()
            return@runBlocking UploadResult(false, "Limite de ${settings.maxItems} itens atingido no quiosque.")
        }

        val extension = name.substringAfterLast('.', "").lowercase()
        val kind = when {
            mimeType == "application/pdf" || extension == "pdf" -> ItemKind.PDF
            mimeType.startsWith("image/") || extension in IMAGE_EXTENSIONS -> ItemKind.IMAGE
            else -> null
        }
        if (kind == null) {
            file.delete()
            return@runBlocking UploadResult(false, "Envie apenas fotos ou arquivos PDF.")
        }

        val label = if (kind == ItemKind.IMAGE) "Foto ${items.size + 1}" else name.substringBeforeLast('.')
        when (val result = ItemLoader.loadLocal(file, kind, label)) {
            is ItemLoader.Result.Success -> {
                items.add(result.item)
                phoneReceivedCount++
                UploadResult(true, "Enviado")
            }
            is ItemLoader.Result.Failure -> UploadResult(false, result.message)
        }
    }

    private fun uploadPage(): String {
        val html = app.resources.openRawResource(R.raw.upload).bufferedReader().use { it.readText() }
        val name = settings.kioskName
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
        return html.replace("{{KIOSK}}", name)
    }

    private fun randomToken(): String {
        val alphabet = "abcdefghijkmnpqrstuvwxyz23456789"
        val random = SecureRandom()
        return (1..10).map { alphabet[random.nextInt(alphabet.length)] }.joinToString("")
    }

    override fun onCleared() {
        closePhoneUpload()
        super.onCleared()
    }

    // endregion

    // region Checkout

    /** Called by the Print / Pay button on the review screen. */
    fun checkout() {
        refreshLicense()
        if (!canPrint && paid == null) {
            step = KioskStep.Finished(false, blockedMessage())
            return
        }
        if (!requiresPayment || paid != null) {
            sendToPrinter()
            return
        }
        registerInteraction()
        voucherError = null
        step = KioskStep.ChooseMethod
    }

    fun retryPayment() {
        when (lastMethod) {
            "card" -> payWithCard()
            else -> payWithPix()
        }
    }

    fun payWithPix() {
        lastMethod = "pix"
        val currentToken = token
        if (!isPixConfigured || currentToken == null) {
            step = KioskStep.Finished(false, "O pagamento por Pix ainda não foi configurado. Peça ajuda a um atendente.")
            return
        }
        registerInteraction()
        step = KioskStep.Payment
        paymentState = PaymentState.Preparing
        paymentJob?.cancel()
        paymentJob = viewModelScope.launch { runPayment(currentToken) }
    }

    /** Sends the amount to the Point terminal and waits for the customer to pay there. */
    fun payWithCard() {
        lastMethod = "card"
        val currentToken = token
        val terminal = pointTerminal
        if (currentToken == null || terminal == null) {
            step = KioskStep.Finished(false, "A maquininha ainda não foi configurada. Peça ajuda a um atendente.")
            return
        }
        registerInteraction()
        step = KioskStep.Payment
        paymentState = PaymentState.Preparing
        paymentJob?.cancel()
        paymentJob = viewModelScope.launch { runCardPayment(currentToken, terminal) }
    }

    private suspend fun runCardPayment(accessToken: String, terminal: String) {
        val point = PointService(accessToken)
        val cents = amountCents
        val orderId = try {
            point.createOrder(terminal, cents, settings.paymentTimeoutSeconds, "${settings.kioskName} – $totalPages página(s)")
        } catch (e: PixException) {
            paymentState = PaymentState.Failed(e.message ?: "Não foi possível enviar para a maquininha.")
            return
        }
        activeOrder = orderId
        val deadline = System.currentTimeMillis() + settings.paymentTimeoutSeconds * 1_000L
        paymentDeadline = deadline
        paymentState = PaymentState.CardWaiting(orderId, cents)
        while (System.currentTimeMillis() < deadline) {
            delay(3_000)
            val status = try { point.status(orderId) } catch (e: PixException) { continue }
            if (status == PointService.Status.APPROVED) {
                cardApproved(orderId, cents)
                return
            }
            if (status == PointService.Status.FAILED) {
                activeOrder = null
                paymentDeadline = null
                paymentState = PaymentState.Failed("O pagamento foi recusado ou cancelado na maquininha. Nenhum valor foi cobrado.")
                return
            }
        }
        if (point.cancel(orderId) == PointService.Status.APPROVED) {
            cardApproved(orderId, cents)
            return
        }
        activeOrder = null
        paymentDeadline = null
        paymentState = PaymentState.Expired
    }

    private fun cardApproved(orderId: String, cents: Int) {
        paid = Paid("card", orderId, cents)
        activeOrder = null
        paymentDeadline = null
        sendToPrinter()
    }

    fun openVoucher() {
        registerInteraction()
        voucherError = null
        step = KioskStep.Voucher
    }

    fun backToMethods() {
        voucherError = null
        step = KioskStep.ChooseMethod
    }

    /** Takes this print's value from a voucher made in the dashboard. */
    fun redeemVoucher(code: String) {
        if (voucherBusy) return
        registerInteraction()
        voucherBusy = true
        voucherError = null
        val cents = amountCents
        val ref = java.util.UUID.randomUUID().toString()
        val formatted = code.take(5) + "-" + code.drop(5)
        viewModelScope.launch {
            val json = cloud.voucher(storeCode, "redeem", formatted, cents, ref)
            voucherBusy = false
            when {
                json == null -> voucherError = "Sem conexão com o painel. Verifique a internet e tente de novo."
                !json.optBoolean("ok") -> voucherError = json.optString("error").ifEmpty { "Não foi possível usar o voucher." }
                else -> {
                    paid = Paid("voucher", ref, cents)
                    voucherBalance = if (json.isNull("balanceCents")) null else json.optInt("balanceCents")
                    step = KioskStep.Payment
                    paymentState = PaymentState.Preparing
                    sendToPrinter()
                }
            }
        }
    }

    private suspend fun runPayment(accessToken: String) {
        val pix = PixService(accessToken)
        val charge = try {
            pix.createCharge(
                amountCents = amountCents,
                description = "${settings.kioskName} – $totalPages página(s)",
                payerEmail = settings.payerEmail,
            )
        } catch (e: PixException) {
            paymentState = PaymentState.Failed(e.message ?: "Não foi possível criar a cobrança.")
            return
        }

        activeCharge = charge
        val deadline = System.currentTimeMillis() + settings.paymentTimeoutSeconds * 1_000L
        paymentDeadline = deadline
        paymentState = PaymentState.Waiting(charge)

        // Check every 3 seconds until paid, refused, or out of time.
        while (System.currentTimeMillis() < deadline) {
            delay(3_000)
            val status = try { pix.status(charge.id) } catch (e: PixException) { continue } // brief network blip
            if (status == PixService.Status.APPROVED) {
                paymentApproved(charge)
                return
            }
            if (status.isFinalFailure) {
                activeCharge = null
                paymentDeadline = null
                paymentState = PaymentState.Failed("O pagamento foi recusado ou cancelado. Nenhum valor foi cobrado.")
                return
            }
        }

        // Time is up. Check one last time in case the payment landed at the last second.
        val lastStatus = try { pix.status(charge.id) } catch (e: PixException) { null }
        if (lastStatus == PixService.Status.APPROVED) {
            paymentApproved(charge)
            return
        }
        try { pix.cancel(charge.id) } catch (e: PixException) { }
        activeCharge = null
        paymentDeadline = null
        paymentState = PaymentState.Expired
    }

    /** The customer tapped Cancel while the QR Code or the terminal was waiting. */
    fun cancelPayment() {
        paymentJob?.cancel()
        paymentJob = null
        paymentDeadline = null

        val order = activeOrder
        if (order != null) {
            val orderToken = token
            activeOrder = null
            val cents = (paymentState as? PaymentState.CardWaiting)?.amountCents ?: amountCents
            paymentState = PaymentState.Preparing
            if (orderToken == null) {
                step = KioskStep.ChooseMethod
                return
            }
            viewModelScope.launch {
                // If they paid just before tapping Cancel, print anyway instead of keeping their money.
                if (PointService(orderToken).cancel(order) == PointService.Status.APPROVED) {
                    cardApproved(order, cents)
                } else {
                    step = KioskStep.ChooseMethod
                }
            }
            return
        }

        val charge = activeCharge
        val currentToken = token
        if (charge == null || currentToken == null) {
            step = KioskStep.ChooseMethod
            return
        }
        activeCharge = null
        paymentState = PaymentState.Preparing
        viewModelScope.launch {
            val pix = PixService(currentToken)
            // If they paid just before tapping Cancel, print anyway instead of keeping their money.
            val status = try { pix.status(charge.id) } catch (e: PixException) { null }
            if (status == PixService.Status.APPROVED) {
                paymentApproved(charge)
                return@launch
            }
            try { pix.cancel(charge.id) } catch (e: PixException) { }
            step = KioskStep.ChooseMethod
        }
    }

    private fun paymentApproved(charge: PixCharge) {
        paid = Paid("pix", charge.id.toString(), charge.amountCents)
        activeCharge = null
        paymentDeadline = null
        sendToPrinter()
    }

    // endregion

    // region Printing

    fun sendToPrinter() {
        val launcher = printLauncher
        if (launcher == null) {
            step = KioskStep.Finished(false, "Não foi possível abrir a impressão. Tente de novo.")
            return
        }
        step = KioskStep.Printing

        val job = launcher(KioskPrintAdapter(app, items.toList(), copies, watermarked), settings.kioskName)
        if (job == null) {
            step = KioskStep.Finished(false, "Não foi possível abrir a impressão. Tente de novo.")
            return
        }

        // Follow the job until Android hands it to the printer, or the customer cancels.
        viewModelScope.launch {
            val started = System.currentTimeMillis()
            while (isActive) {
                delay(1_000)
                when {
                    job.isQueued || job.isStarted || job.isCompleted -> {
                        paidPrinted = true
                        val demo = !Edition.FREE && license !is LicenseState.Active
                        if (demo) {
                            licenseStore.recordDemoPrint()
                            refreshLicense()
                        }
                        recordPrint(success = true, demo = demo)
                        step = KioskStep.Finished(true, null)
                        return@launch
                    }
                    job.isCancelled -> {
                        step = KioskStep.Finished(false, "A impressão foi cancelada.")
                        return@launch
                    }
                    job.isFailed -> {
                        recordPrint(success = false, demo = license !is LicenseState.Active)
                        step = KioskStep.Finished(false, "A impressora informou um erro. Verifique se ela está ligada e no mesmo Wi-Fi, e tente de novo.")
                        return@launch
                    }
                    System.currentTimeMillis() - started > 15 * 60_000L -> {
                        step = KioskStep.Finished(false, "A impressão não foi confirmada. Tente de novo.")
                        return@launch
                    }
                }
            }
        }
    }

    fun printTestPage() {
        printLauncher?.invoke(TestPageAdapter(app, settings.kioskName), "${settings.kioskName} – teste")
    }

    // endregion

    // region Subscription

    fun refreshLicense() {
        license = licenseStore.state()
    }

    /** Checks and saves a monthly activation code; returns a message for the staff screen. */
    fun activateLicense(code: String): String {
        val until = licenseStore.activate(code)
            ?: return "Código inválido para esta loja. Confira se copiou o código inteiro, começando por PK1-."
        refreshLicense()
        val date = LicenseCodec.date(until).format(java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy"))
        return if (license is LicenseState.Active) "Assinatura ativa até $date." else "Este código venceu em $date."
    }

    private fun blockedMessage(): String = when (license) {
        is LicenseState.Expired -> "A assinatura deste quiosque venceu. Peça ajuda a um atendente."
        else -> "A demonstração terminou (${LicenseCodec.DEMO_PRINTS} impressões). Peça ajuda a um atendente."
    }

    // endregion

    // region Staff settings

    fun updateSettings(transform: (KioskSettings) -> KioskSettings) {
        settings = transform(settings)
        settingsStore.save(settings)
        if (copies > settings.maxCopies) copies = settings.maxCopies
    }

    fun saveToken(value: String) {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return
        SecureStore.setToken(app, trimmed)
        tokenSuffix = trimmed.takeLast(4)
    }

    fun removeToken() {
        SecureStore.setToken(app, null)
        tokenSuffix = null
    }

    /** Point terminals of the Mercado Pago account, or an error message. */
    suspend fun findTerminals(): Pair<List<PointService.Terminal>, String?> {
        val currentToken = token ?: return emptyList<PointService.Terminal>() to "Salve o Access Token do Mercado Pago primeiro."
        return try {
            PointService(currentToken).terminals() to null
        } catch (e: PixException) {
            emptyList<PointService.Terminal>() to (e.message ?: "Não foi possível buscar as maquininhas.")
        }
    }

    /** Uses this terminal for card payments (puts it in PDV mode); null turns card payments off. */
    suspend fun useTerminal(id: String?): String? {
        if (id != null) {
            val currentToken = token ?: return "Salve o Access Token do Mercado Pago primeiro."
            try {
                PointService(currentToken).setPdvMode(id)
            } catch (e: PixException) {
                return e.message ?: "Não foi possível configurar a maquininha."
            }
        }
        pointPrefs.edit().apply { if (id == null) remove("terminal") else putString("terminal", id) }.apply()
        pointTerminal = id
        return null
    }

    suspend fun testConnection(): String {
        val currentToken = token ?: return "Nenhum token salvo."
        return try {
            "Conectado à conta ${PixService(currentToken).accountName()}."
        } catch (e: PixException) {
            e.message ?: "Não foi possível conectar."
        }
    }

    // endregion

    private companion object {
        val IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "bmp")
    }
}
