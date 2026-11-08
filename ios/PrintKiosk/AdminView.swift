import SwiftUI

/// Staff-only settings, opened by long-pressing the top-right corner of the welcome screen.
struct AdminView: View {
    @EnvironmentObject private var store: KioskStore
    @Environment(\.dismiss) private var dismiss

    @State private var unlocked = false
    @State private var pinEntry = ""
    @State private var pinError = false
    @State private var newPIN = ""
    @State private var pinChanged = false

    @State private var tokenEntry = ""
    @State private var tokenSuffix = Keychain.get(KioskStore.mercadoPagoTokenKey).map { String($0.suffix(4)) }
    @State private var connectionStatus: String?
    @State private var isTesting = false

    @State private var activationCode = ""
    @State private var activationMessage: String?

    init() {}

    var body: some View {
        NavigationStack {
            Group {
                if unlocked { settingsForm } else { pinGate }
            }
            .navigationTitle("Configurações do atendente")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fechar") { dismiss() }
                }
            }
        }
    }

    // MARK: PIN gate

    private var pinGate: some View {
        VStack(spacing: 20) {
            Image(systemName: "lock.fill")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Digite o PIN do atendente")
                .font(.title2)
            SecureField("PIN", text: $pinEntry)
                .keyboardType(.numberPad)
                .font(.title)
                .multilineTextAlignment(.center)
                .textFieldStyle(.roundedBorder)
                .frame(width: 220)
                .onSubmit(checkPIN)
            if pinError {
                Text("PIN incorreto.")
                    .foregroundStyle(.red)
            }
            Button("Desbloquear", action: checkPIN)
                .buttonStyle(PrimaryButtonStyle())
        }
        .padding(40)
    }

    private func checkPIN() {
        if pinEntry == store.settings.adminPIN {
            unlocked = true
            pinError = false
        } else {
            pinError = true
        }
        pinEntry = ""
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
            } header: {
                Text("Assinatura")
            } footer: {
                Text("Assinatura \(License.priceLabel). Envie o código da loja para \(License.vendorContact) para receber o código de ativação do mês e cole-o acima. Sem assinatura, o app faz \(License.demoPrints) impressões de demonstração.")
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
                Text("Deixe o preço em R$ 0,00 para impressão gratuita. O Mercado Pago exige um e-mail de pagador em toda cobrança Pix; use o e-mail da loja. O token fica guardado no Keychain deste iPad.")
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
                SecureField("Novo PIN (4 ou mais dígitos)", text: $newPIN)
                    .keyboardType(.numberPad)
                Button("Alterar PIN") {
                    store.settings.adminPIN = newPIN
                    newPIN = ""
                    pinChanged = true
                }
                .disabled(newPIN.count < 4 || !newPIN.allSatisfy(\.isNumber))
                if pinChanged {
                    Text("PIN alterado.")
                        .foregroundStyle(.green)
                }
            }

            Section {
                Text("Para impedir que clientes saiam do app, ative o Acesso Guiado (Ajustes › Acessibilidade › Acesso Guiado) e clique três vezes no botão lateral ou de Início com este app aberto. iPads gerenciados podem usar o Modo de App Único do MDM.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var licenseStatus: some View {
        switch store.license {
        case .active(let until):
            Label("Ativa até \(until.formatted(date: .numeric, time: .omitted))", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
        case .demo(let remaining):
            Label("Demonstração: \(remaining) de \(License.demoPrints) impressões restantes", systemImage: "sparkles")
                .foregroundStyle(.orange)
        case .expired(let on):
            Label("Vencida em \(on.formatted(date: .numeric, time: .omitted))", systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
        case .demoOver:
            Label("Demonstração encerrada", systemImage: "lock.fill")
                .foregroundStyle(.red)
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
