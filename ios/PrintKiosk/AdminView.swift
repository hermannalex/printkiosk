import SwiftUI

/// Staff-only settings, behind a PIN that only exists as a hash in the Keychain (see AdminLock).
struct AdminView: View {
    @EnvironmentObject private var store: KioskStore
    @Environment(\.dismiss) private var dismiss

    @State private var unlocked = false
    @State private var pinEntry = ""
    @State private var pinMessage: String?
    @State private var newPIN = ""
    @State private var confirmPIN = ""
    @State private var pinIsSet = AdminLock.isSet
    @FocusState private var focusedField: PINField?
    @Environment(\.horizontalSizeClass) private var sizeClass

    private enum PINField { case entry, new, confirm, changeNew, changeConfirm }
    @State private var pinChanged = false

    @State private var tokenEntry = ""
    @State private var tokenSuffix = Keychain.get(KioskStore.mercadoPagoTokenKey).map { String($0.suffix(4)) }
    @State private var connectionStatus: String?
    @State private var isTesting = false

    @State private var activationCode = ""
    @State private var activationMessage: String?
    @State private var terminals: [PointService.Terminal] = []
    @State private var pointMessage: String?
    @State private var pointBusy = false

    init() {}

    var body: some View {
        NavigationStack {
            Group {
                if unlocked { settingsForm } else { pinGate }
            }
            .navigationTitle("Configurações")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fechar") { dismiss() }
                }
                // The number pad has no Return key on iPhone: this bar sits on top of it.
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    if unlocked {
                        Button("OK") {
                            focusedField = nil
                            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                        }
                    } else {
                        Button(pinIsSet ? "Desbloquear" : "Criar PIN") {
                            if pinIsSet { checkPIN() } else { createPIN() }
                        }
                        .fontWeight(.semibold)
                    }
                }
            }
        }
    }

    // MARK: PIN gate

    private var pinGate: some View {
        ScrollView {
        VStack(spacing: 20) {
            Image(systemName: "lock.fill")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            if pinIsSet {
                Text("Digite o PIN do atendente")
                    .font(.title2)
                pinField("PIN", text: $pinEntry)
                    .focused($focusedField, equals: .entry)
            } else {
                Text("Crie o PIN do atendente")
                    .font(.title2)
                Text("Ele protege a impressora, o recebimento Pix e a assinatura. Use \(AdminLock.minimumLength) a 12 números, sem sequências como 123456.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 420)
                pinField("Novo PIN", text: $newPIN)
                    .focused($focusedField, equals: .new)
                pinField("Repita o PIN", text: $confirmPIN)
                    .focused($focusedField, equals: .confirm)
            }
            if let pinMessage {
                Text(pinMessage)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
            Button(pinIsSet ? "Desbloquear" : "Criar PIN", action: pinIsSet ? checkPIN : createPIN)
                .buttonStyle(PrimaryButtonStyle())
        }
        .padding(sizeClass == .compact ? 24 : 40)
        .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear {
            AdminLock.migrate(legacyPIN: store.settings.adminPIN)
            if !store.settings.adminPIN.isEmpty { store.settings.adminPIN = "" }
            pinIsSet = AdminLock.isSet
            focusedField = pinIsSet ? .entry : .new
        }
    }

    private func pinField(_ title: String, text: Binding<String>) -> some View {
        SecureField(title, text: text)
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .font(.title)
            .multilineTextAlignment(.center)
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 260)
    }

    private func checkPIN() {
        switch AdminLock.check(pinEntry) {
        case .ok:
            focusedField = nil
            unlocked = true
            pinMessage = nil
        case .wrong(let left):
            pinMessage = left > 0 ? "PIN incorreto. \(left) tentativa(s) antes do bloqueio." : "PIN incorreto."
        case .locked(let seconds):
            pinMessage = "Muitas tentativas erradas. Tente de novo em \(Self.duration(seconds))."
        }
        pinEntry = ""
    }

    private func createPIN() {
        if let message = Self.problem(newPIN: newPIN, confirm: confirmPIN) {
            pinMessage = message
            return
        }
        AdminLock.save(newPIN)
        newPIN = ""
        confirmPIN = ""
        pinMessage = nil
        pinIsSet = true
        focusedField = nil
        unlocked = true
    }

    static func problem(newPIN: String, confirm: String) -> String? {
        if !AdminLock.isAcceptable(newPIN) {
            return "Use de \(AdminLock.minimumLength) a 12 números, sem repetir o mesmo número nem fazer sequências."
        }
        if newPIN != confirm { return "Os dois PINs não são iguais." }
        return nil
    }

    static func duration(_ seconds: Int) -> String {
        seconds < 60 ? "\(seconds) segundos" : "\((seconds + 59) / 60) minuto(s)"
    }

    // MARK: Settings

    private var settingsForm: some View {
        Form {
            Section {
                licenseStatus
                LabeledContent("Código da loja") {
                    HStack(spacing: 12) {
                        Text(store.storeCode)
                            .font(.body.monospaced().weight(.semibold))
                            .textSelection(.enabled)
                        Button("Copiar") { UIPasteboard.general.string = store.storeCode }
                    }
                }
                LabeledContent("Código de vinculação") {
                    Text(store.cloud.pairingCode)
                        .font(.body.monospaced().weight(.semibold))
                        .textSelection(.enabled)
                }
                TextField("Cole aqui o código de ativação (começa com PK1-)", text: $activationCode, axis: .vertical)
                    .lineLimit(2...4)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("Ativar") {
                    activationMessage = store.activateLicense(code: activationCode)
                    if store.isSubscribed { activationCode = "" }
                }
                .disabled(activationCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if let activationMessage {
                    Text(activationMessage)
                        .font(.callout)
                }
                LabeledContent("Painel online") {
                    Link(store.cloud.dashboardURL.host() ?? "Abrir", destination: store.cloud.dashboardURL)
                }
                LabeledContent("Última sincronização") {
                    if let error = store.syncError {
                        Text(error).foregroundStyle(.red)
                    } else if let lastSync = store.lastSync {
                        Text(lastSync, format: .relative(presentation: .named))
                    } else {
                        Text("Ainda não conectou")
                    }
                }
                Button("Sincronizar agora") {
                    Task { await store.syncWithDashboard() }
                }
            } header: {
                Text("Assinatura")
            } footer: {
                Text("Crie sua conta no painel online e adicione este quiosque com o código da loja e o código de vinculação (não mostre esse código a clientes). Ao pagar a assinatura por lá, o quiosque é liberado sozinho na próxima conexão. O painel mostra impressões, cópias e faturamento. Sem assinatura, as \(License.demoPrints) primeiras impressões saem normais e as seguintes com a marca d'água imprime.ai.")
            }

            Section("Impressora") {
                LabeledContent("Impressora atual", value: store.settings.printerName ?? "Nenhuma")
                Button("Escolher impressora…") { store.choosePrinter() }
            }

            Section {
                TextField("Nome da rede (SSID)", text: $store.settings.wifiName)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Senha da rede (deixe vazio se for aberta)", text: $store.settings.wifiPassword)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } header: {
                Text("Wi-Fi da loja")
            } footer: {
                Text("Com o nome e a senha preenchidos, a tela inicial e a tela Do celular mostram um QR Code que conecta o celular do cliente ao Wi-Fi sem digitar nada. Para enviar arquivos pelo celular, este aparelho precisa estar nessa mesma rede.")
            }

            Section {
                Stepper(
                    "Preço por página: \(Money.format(cents: store.settings.pricePerPageCents))",
                    value: $store.settings.pricePerPageCents,
                    in: 0...5000,
                    step: 10
                )

                TextField("E-mail do pagador", text: $store.settings.payerEmail)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                LabeledContent(
                    "Access Token",
                    value: tokenSuffix.map { "Salvo (termina em \($0))" } ?? "Não configurado"
                )

                SecureField("Cole aqui o Access Token de produção", text: $tokenEntry)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                Button("Salvar token") {
                    let token = tokenEntry.trimmingCharacters(in: .whitespacesAndNewlines)
                    Keychain.set(token, for: KioskStore.mercadoPagoTokenKey)
                    tokenSuffix = String(token.suffix(4))
                    tokenEntry = ""
                    connectionStatus = nil
                }
                .disabled(tokenEntry.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button(isTesting ? "Testando…" : "Testar conexão") { testConnection() }
                    .disabled(tokenSuffix == nil || isTesting)

                if let connectionStatus {
                    Text(connectionStatus)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Picker("Tempo para pagar", selection: $store.settings.paymentTimeoutSeconds) {
                    Text("2 minutos").tag(120)
                    Text("3 minutos").tag(180)
                    Text("5 minutos").tag(300)
                    Text("10 minutos").tag(600)
                }

                if tokenSuffix != nil {
                    Button("Remover token", role: .destructive) {
                        Keychain.set(nil, for: KioskStore.mercadoPagoTokenKey)
                        tokenSuffix = nil
                        connectionStatus = nil
                    }
                }
            } header: {
                Text("Pagamento Pix (Mercado Pago)")
            } footer: {
                Text("Estas configurações também podem ser mudadas pelo painel online (quioco.vercel.app); o que for salvo lá chega em até 30 minutos. Deixe o preço em R$ 0,00 para impressão gratuita. O Mercado Pago exige um e-mail de pagador em toda cobrança Pix; use o e-mail da loja. O token fica guardado no Keychain deste iPad.")
            }

            Section {
                Text(store.pointTerminal.map { "Maquininha em uso: \($0)" } ?? "Nenhuma maquininha ligada. O cliente paga só com Pix ou voucher.")
                Button(pointBusy ? "Buscando…" : "Buscar maquininhas") {
                    pointBusy = true
                    pointMessage = nil
                    Task {
                        let (list, error) = await store.findTerminals()
                        terminals = list
                        pointMessage = error ?? "\(list.count) maquininha(s) encontrada(s). Toque na que fica ao lado do quiosque."
                        pointBusy = false
                    }
                }
                .disabled(tokenSuffix == nil || pointBusy)
                ForEach(terminals) { terminal in
                    Button(terminal.id) {
                        pointBusy = true
                        Task {
                            let error = await store.useTerminal(terminal.id)
                            pointMessage = error ?? "Maquininha ligada ao quiosque e colocada no modo de integração (PDV)."
                            if error == nil { terminals = [] }
                            pointBusy = false
                        }
                    }
                    .disabled(pointBusy)
                }
                if store.pointTerminal != nil {
                    Button("Desligar maquininha", role: .destructive) {
                        Task { _ = await store.useTerminal(nil) }
                        pointMessage = "Maquininha desligada do quiosque."
                    }
                }
                if let pointMessage { Text(pointMessage).foregroundStyle(.secondary) }
            } header: {
                Text("Maquininha (cartão e aproximação)")
            } footer: {
                Text("Com uma Point Smart ou Point Pro 2 do Mercado Pago, da mesma conta do token, o cliente paga com cartão de crédito ou débito, por aproximação, Apple Pay ou Google Pay. O valor aparece sozinho na maquininha.")
            }

            Section("Quiosque") {
                TextField("Nome do quiosque", text: $store.settings.kioskName)
                Stepper("Máximo de cópias: \(store.settings.maxCopies)",
                        value: $store.settings.maxCopies, in: 1...50)
                Stepper("Máximo de itens por impressão: \(store.settings.maxItems)",
                        value: $store.settings.maxItems, in: 1...50)
                Picker("Voltar ao início após inatividade", selection: $store.settings.idleTimeoutSeconds) {
                    Text("30 segundos").tag(30)
                    Text("1 minuto").tag(60)
                    Text("90 segundos").tag(90)
                    Text("2 minutos").tag(120)
                    Text("5 minutos").tag(300)
                }
            }

            Section("PIN do atendente") {
                SecureField("Novo PIN (\(AdminLock.minimumLength) a 12 números)", text: $newPIN)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .focused($focusedField, equals: .changeNew)
                SecureField("Repita o novo PIN", text: $confirmPIN)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .focused($focusedField, equals: .changeConfirm)
                Button("Alterar PIN") {
                    focusedField = nil
                    if let message = Self.problem(newPIN: newPIN, confirm: confirmPIN) {
                        pinMessage = message
                        pinChanged = false
                    } else {
                        AdminLock.save(newPIN)
                        pinMessage = nil
                        pinChanged = true
                    }
                    newPIN = ""
                    confirmPIN = ""
                }
                .disabled(newPIN.isEmpty)
                if pinChanged {
                    Text("PIN alterado.")
                        .foregroundStyle(.green)
                } else if unlocked, let pinMessage {
                    Text(pinMessage)
                        .foregroundStyle(.red)
                }
            }

            Section {
                Text("Para impedir que clientes saiam do app, ative o Acesso Guiado (Ajustes › Acessibilidade › Acesso Guiado) e clique três vezes no botão lateral ou de Início com este app aberto. iPads gerenciados podem usar o Modo de App Único do MDM.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder
    private var licenseStatus: some View {
        switch store.license {
        case .active(let until):
            Label("Ativa até \(until.formatted(date: .numeric, time: .omitted))", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
        case .demo(let remaining):
            Label("Teste grátis: \(remaining) de \(License.demoPrints) impressões sem marca d'água", systemImage: "sparkles")
                .foregroundStyle(.orange)
        case .expired(let on):
            Label("Vencida em \(on.formatted(date: .numeric, time: .omitted)) · imprimindo com marca d'água", systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
        case .demoOver:
            Label("Teste encerrado · imprimindo com marca d'água imprime.ai", systemImage: "drop.fill")
                .foregroundStyle(.indigo)
        }
    }

    private func testConnection() {
        guard let token = Keychain.get(KioskStore.mercadoPagoTokenKey) else { return }
        isTesting = true
        connectionStatus = nil
        Task { @MainActor in
            defer { isTesting = false }
            do {
                let name = try await PixService(accessToken: token).accountName()
                connectionStatus = "Conectado à conta \(name)."
            } catch {
                connectionStatus = error.localizedDescription
            }
        }
    }
}
