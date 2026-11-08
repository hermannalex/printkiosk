package br.com.somainfo.quioco

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch

/** Staff-only settings, opened from the Configurações button on the welcome screen. */
@Composable
fun AdminScreen(
    vm: KioskViewModel,
    onPinScreen: () -> Unit,
    onUnpinScreen: () -> Unit,
    onClose: () -> Unit,
) {
    var unlocked by remember { mutableStateOf(false) }

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Configurações do atendente",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = onClose) { Text("Fechar", style = MaterialTheme.typography.titleMedium) }
                }
                if (unlocked) {
                    SettingsForm(vm, onPinScreen, onUnpinScreen)
                } else {
                    PinGate(vm, onUnlock = { unlocked = true })
                }
            }
        }
    }
}

@Composable
private fun PinGate(vm: KioskViewModel, onUnlock: () -> Unit) {
    var pin by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var isSet by remember {
        vm.migrateLegacyPin()
        mutableStateOf(vm.adminLock.isSet)
    }

    fun submit() {
        if (isSet) {
            message = when (val result = vm.adminLock.check(pin)) {
                AdminLock.Result.Ok -> { onUnlock(); null }
                is AdminLock.Result.Wrong ->
                    if (result.triesLeft > 0) "PIN incorreto. ${result.triesLeft} tentativa(s) antes do bloqueio." else "PIN incorreto."
                is AdminLock.Result.Locked ->
                    "Muitas tentativas erradas. Tente de novo em ${AdminLock.duration(result.seconds)}."
            }
        } else {
            message = AdminLock.problem(pin, confirm)
            if (message == null) {
                vm.adminLock.save(pin)
                isSet = true
                onUnlock()
            }
        }
        pin = ""
        confirm = ""
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically),
    ) {
        Icon(Icons.Filled.Lock, contentDescription = null, modifier = Modifier.size(56.dp))
        Text(
            if (isSet) "Digite o PIN do atendente" else "Crie o PIN do atendente",
            style = MaterialTheme.typography.headlineSmall,
        )
        if (!isSet) {
            Text(
                "Ele protege a impressora, o recebimento Pix e a assinatura. Use ${AdminLock.MIN_LENGTH} a 12 números, sem sequências como 123456.",
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.widthIn(max = 480.dp),
            )
        }
        OutlinedTextField(
            value = pin,
            onValueChange = { value -> pin = value.filter { it.isDigit() }.take(12) },
            label = { Text(if (isSet) "PIN" else "Novo PIN") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            modifier = Modifier.widthIn(max = 260.dp),
        )
        if (!isSet) {
            OutlinedTextField(
                value = confirm,
                onValueChange = { value -> confirm = value.filter { it.isDigit() }.take(12) },
                label = { Text("Repita o PIN") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.widthIn(max = 260.dp),
            )
        }
        message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        PrimaryButton(text = if (isSet) "Desbloquear" else "Criar PIN", onClick = { submit() })
    }
}

@Composable
private fun SettingsForm(vm: KioskViewModel, onPinScreen: () -> Unit, onUnpinScreen: () -> Unit) {
    val settings = vm.settings
    val scope = rememberCoroutineScope()
    var tokenEntry by remember { mutableStateOf("") }
    var connectionStatus by remember { mutableStateOf<String?>(null) }
    var testing by remember { mutableStateOf(false) }
    var newPin by remember { mutableStateOf("") }
    var confirmPin by remember { mutableStateOf("") }
    var pinProblem by remember { mutableStateOf<String?>(null) }
    var pinChanged by remember { mutableStateOf(false) }
    var activationCode by remember { mutableStateOf("") }
    var activationMessage by remember { mutableStateOf<String?>(null) }
    val clipboard = LocalClipboardManager.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Section("Assinatura") {
            val dateFormat = java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy")
            val (status, color) = when (val license = vm.license) {
                is LicenseState.Active -> "Ativa até ${license.until.format(dateFormat)}" to KioskGreen
                is LicenseState.Demo -> "Demonstração: ${license.remaining} de ${LicenseCodec.DEMO_PRINTS} impressões restantes" to KioskOrange
                is LicenseState.Expired -> "Vencida em ${license.on.format(dateFormat)}" to MaterialTheme.colorScheme.error
                LicenseState.DemoOver -> "Demonstração encerrada" to MaterialTheme.colorScheme.error
            }
            Text(status, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = color)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Código da loja: ${vm.storeCode}", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = { clipboard.setText(AnnotatedString(vm.storeCode)) }) { Text("Copiar") }
            }
            Text("Código de vinculação: ${vm.cloud.pairingCode}", style = MaterialTheme.typography.titleMedium)
            Text(
                "Crie sua conta no painel online e adicione este quiosque com o código da loja e o código de " +
                    "vinculação (não mostre esse código a clientes). Ao pagar a " +
                    "assinatura por lá, o quiosque é liberado sozinho na próxima conexão. Se recebeu um código " +
                    "de ativação, também pode colá-lo abaixo.",
                style = MaterialTheme.typography.bodyLarge,
            )
            OutlinedTextField(
                value = activationCode,
                onValueChange = {
                    activationCode = it
                    activationMessage = null
                },
                label = { Text("Código de ativação (começa com PK1-)") },
                minLines = 2,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    activationMessage = vm.activateLicense(activationCode)
                    if (vm.license is LicenseState.Active) activationCode = ""
                },
                enabled = activationCode.isNotBlank(),
            ) { Text("Ativar") }
            activationMessage?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
            Text("Painel online: ${vm.cloud.dashboardUrl.removePrefix("https://")}", style = MaterialTheme.typography.titleMedium)
            val syncText = vm.syncError ?: vm.lastSync?.let {
                "Última sincronização: " + android.text.format.DateUtils.getRelativeTimeSpanString(it).toString().lowercase()
            } ?: "Ainda não conectou ao painel"
            Text(
                syncText,
                style = MaterialTheme.typography.bodyLarge,
                color = if (vm.syncError != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
            )
            OutlinedButton(onClick = { vm.syncNow() }) { Text("Sincronizar agora") }
        }

        Section("Impressora") {
            Text(
                "No Android, a impressora é escolhida na janela de impressão, que lembra a última usada. " +
                    "Imprima uma página de teste e escolha a impressora da loja nessa janela.",
                style = MaterialTheme.typography.bodyLarge,
            )
            OutlinedButton(onClick = { vm.printTestPage() }) { Text("Imprimir página de teste") }
        }

        Section("Wi-Fi da loja") {
            Text(
                "Com o nome e a senha preenchidos, a tela inicial e a tela Do celular mostram um QR Code " +
                    "que conecta o celular do cliente ao Wi-Fi sem digitar nada. Para enviar arquivos pelo " +
                    "celular, o tablet precisa estar nessa mesma rede.",
                style = MaterialTheme.typography.bodyLarge,
            )
            OutlinedTextField(
                value = settings.wifiName,
                onValueChange = { value -> vm.updateSettings { it.copy(wifiName = value) } },
                label = { Text("Nome da rede (SSID)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = settings.wifiPassword,
                onValueChange = { value -> vm.updateSettings { it.copy(wifiPassword = value) } },
                label = { Text("Senha da rede (deixe vazio se for aberta)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Section("Pagamento Pix (Mercado Pago)") {
            StepperRow(
                label = "Preço por página: ${Money.format(settings.pricePerPageCents)}",
                onMinus = { vm.updateSettings { it.copy(pricePerPageCents = (it.pricePerPageCents - 10).coerceAtLeast(0)) } },
                onPlus = { vm.updateSettings { it.copy(pricePerPageCents = (it.pricePerPageCents + 10).coerceAtMost(5_000)) } },
                minusEnabled = settings.pricePerPageCents > 0,
                plusEnabled = settings.pricePerPageCents < 5_000,
            )
            Text(
                "Deixe em R$ 0,00 para impressão gratuita. Estas configurações também podem ser mudadas pelo painel online (quioco.vercel.app); o que for salvo lá chega em até 30 minutos.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            OutlinedTextField(
                value = settings.payerEmail,
                onValueChange = { value -> vm.updateSettings { it.copy(payerEmail = value.trim()) } },
                label = { Text("E-mail do pagador (e-mail da loja)") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth(),
            )

            Text(
                vm.tokenSuffix?.let { "Access Token: salvo (termina em $it)" } ?: "Access Token: não configurado",
                style = MaterialTheme.typography.titleMedium,
            )
            OutlinedTextField(
                value = tokenEntry,
                onValueChange = { tokenEntry = it },
                label = { Text("Cole aqui o Access Token de produção") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(
                    onClick = {
                        vm.saveToken(tokenEntry)
                        tokenEntry = ""
                        connectionStatus = null
                    },
                    enabled = tokenEntry.isNotBlank(),
                ) { Text("Salvar token") }
                OutlinedButton(
                    onClick = {
                        testing = true
                        connectionStatus = null
                        scope.launch {
                            connectionStatus = vm.testConnection()
                            testing = false
                        }
                    },
                    enabled = vm.tokenSuffix != null && !testing,
                ) { Text(if (testing) "Testando…" else "Testar conexão") }
                if (vm.tokenSuffix != null) {
                    TextButton(onClick = {
                        vm.removeToken()
                        connectionStatus = null
                    }) { Text("Remover token", color = MaterialTheme.colorScheme.error) }
                }
            }
            connectionStatus?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }

            Text("Tempo para pagar", style = MaterialTheme.typography.titleMedium)
            ChoiceRow(
                options = listOf(120 to "2 min", 180 to "3 min", 300 to "5 min", 600 to "10 min"),
                selected = settings.paymentTimeoutSeconds,
                onSelect = { value -> vm.updateSettings { it.copy(paymentTimeoutSeconds = value) } },
            )
            Text(
                "O Mercado Pago exige um e-mail de pagador em toda cobrança Pix. " +
                    "O token fica guardado criptografado neste tablet.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Section("Quiosque") {
            OutlinedTextField(
                value = settings.kioskName,
                onValueChange = { value -> vm.updateSettings { it.copy(kioskName = value) } },
                label = { Text("Nome do quiosque") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            StepperRow(
                label = "Máximo de cópias: ${settings.maxCopies}",
                onMinus = { vm.updateSettings { it.copy(maxCopies = (it.maxCopies - 1).coerceAtLeast(1)) } },
                onPlus = { vm.updateSettings { it.copy(maxCopies = (it.maxCopies + 1).coerceAtMost(50)) } },
                minusEnabled = settings.maxCopies > 1,
                plusEnabled = settings.maxCopies < 50,
            )
            StepperRow(
                label = "Máximo de itens por impressão: ${settings.maxItems}",
                onMinus = { vm.updateSettings { it.copy(maxItems = (it.maxItems - 1).coerceAtLeast(1)) } },
                onPlus = { vm.updateSettings { it.copy(maxItems = (it.maxItems + 1).coerceAtMost(50)) } },
                minusEnabled = settings.maxItems > 1,
                plusEnabled = settings.maxItems < 50,
            )
            Text("Voltar ao início após inatividade", style = MaterialTheme.typography.titleMedium)
            ChoiceRow(
                options = listOf(30 to "30 s", 60 to "1 min", 90 to "90 s", 120 to "2 min", 300 to "5 min"),
                selected = settings.idleTimeoutSeconds,
                onSelect = { value -> vm.updateSettings { it.copy(idleTimeoutSeconds = value) } },
            )
        }

        Section("PIN do atendente") {
            OutlinedTextField(
                value = newPin,
                onValueChange = { value ->
                    newPin = value.filter { it.isDigit() }.take(12)
                    pinChanged = false
                },
                label = { Text("Novo PIN (${AdminLock.MIN_LENGTH} a 12 números)") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.widthIn(max = 320.dp),
            )
            OutlinedTextField(
                value = confirmPin,
                onValueChange = { value ->
                    confirmPin = value.filter { it.isDigit() }.take(12)
                    pinChanged = false
                },
                label = { Text("Repita o novo PIN") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.widthIn(max = 320.dp),
            )
            Button(
                onClick = {
                    pinProblem = AdminLock.problem(newPin, confirmPin)
                    if (pinProblem == null) {
                        vm.adminLock.save(newPin)
                        pinChanged = true
                    }
                    newPin = ""
                    confirmPin = ""
                },
                enabled = newPin.isNotEmpty(),
            ) { Text("Alterar PIN") }
            if (pinChanged) Text("PIN alterado.", color = KioskGreen)
            pinProblem?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }

        Section("Travar o tablet no app") {
            Text(
                "Fixar o app impede que clientes saiam dele. Para soltar, use o botão Desafixar aqui " +
                    "ou mantenha pressionados os botões Voltar e Visão geral ao mesmo tempo.",
                style = MaterialTheme.typography.bodyLarge,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = onPinScreen) { Text("Fixar app na tela") }
                OutlinedButton(onClick = onUnpinScreen) { Text("Desafixar") }
            }
        }

        Spacer(Modifier.size(24.dp))
    }
}

@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            content()
        }
    }
}

@Composable
private fun StepperRow(
    label: String,
    onMinus: () -> Unit,
    onPlus: () -> Unit,
    minusEnabled: Boolean,
    plusEnabled: Boolean,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        FilledIconButton(onClick = onMinus, enabled = minusEnabled) { Icon(Icons.Filled.Remove, contentDescription = "Diminuir") }
        FilledIconButton(onClick = onPlus, enabled = plusEnabled) { Icon(Icons.Filled.Add, contentDescription = "Aumentar") }
    }
}

@Composable
private fun ChoiceRow(options: List<Pair<Int, String>>, selected: Int, onSelect: (Int) -> Unit) {
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        options.forEach { (value, label) ->
            FilterChip(
                selected = value == selected,
                onClick = { onSelect(value) },
                label = { Text(label) },
            )
        }
    }
}
