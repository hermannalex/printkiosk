import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import CoreImage.CIFilterBuiltins

// MARK: - Root

struct RootView: View {
    @EnvironmentObject private var store: KioskStore

    init() {}

    var body: some View {
        ZStack {
            Color(uiColor: .systemGroupedBackground).ignoresSafeArea()

            switch store.step {
            case .welcome:
                WelcomeView()
            case .select:
                SelectView()
            case .review:
                ReviewView()
            case .payment:
                PaymentView()
            case .printing:
                PrintingView()
            case .finished(let success, let message):
                FinishedView(success: success, message: message)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: store.step)
        .fullScreenCover(isPresented: $store.showAdmin) {
            AdminView().environmentObject(store)
        }
        .alert(
            "Atenção",
            isPresented: Binding(
                get: { store.notice != nil },
                set: { if !$0 { store.notice = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(store.notice ?? "")
        }
    }
}

// MARK: - Welcome

struct WelcomeView: View {
    @EnvironmentObject private var store: KioskStore

    init() {}

    private var wifiName: String {
        store.settings.wifiName.trimmingCharacters(in: .whitespaces)
    }

    private var priceLine: String {
        store.requiresPayment
            ? "Imprima aqui por \(Money.format(cents: store.settings.pricePerPageCents))"
            : "Imprima aqui"
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 16)

                    Image(systemName: "printer.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(.tint)

                    // Staff settings (printer, Pix, Wi-Fi, limits). Protected by the staff PIN.
                    Button {
                        store.showAdmin = true
                    } label: {
                        Label("Configurações", systemImage: "gearshape.fill")
                            .font(.headline)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 10)
                            .background(Color(uiColor: .systemBackground), in: Capsule())
                    }
                    .padding(.top, 14)

                    VStack(spacing: 0) {
                        Text("XEROX")
                            .font(.system(size: 132, weight: .black, design: .rounded))
                            .tracking(6)
                        Text("AUTO SERVIÇO")
                            .font(.system(size: 60, weight: .heavy, design: .rounded))
                            .tracking(2)
                            .foregroundStyle(.tint)
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.4)
                    .padding(.top, 28)

                    Text(priceLine)
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .multilineTextAlignment(.center)
                        .minimumScaleFactor(0.5)
                        .padding(.top, 20)

                    Text(store.requiresPayment
                         ? "por página · fotos e PDFs · pagamento via Pix"
                         : "Fotos e PDFs, do seu celular ou deste aparelho")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 6)

                    Button("Toque para começar") { store.start() }
                        .buttonStyle(PrimaryButtonStyle())
                        .padding(.top, 32)

                    if !store.isPrinterConfigured || (store.requiresPayment && !store.isPixConfigured) {
                        Label("Configuração incompleta. Atendente: toque em Configurações.",
                              systemImage: "exclamationmark.triangle.fill")
                            .font(.headline)
                            .foregroundStyle(.orange)
                            .multilineTextAlignment(.center)
                            .padding(.top, 20)
                    }

                    LicenseBanner(license: store.license)
                        .padding(.top, 20)

                    Spacer(minLength: 32)

                    if !wifiName.isEmpty {
                        WiFiCard(name: wifiName, password: store.settings.wifiPassword)
                    }

                    Spacer(minLength: 16)
                }
                .kioskPadding(32)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
        }
    }
}

/// Demo counter or "subscription needed"; nothing while the subscription is active.
struct LicenseBanner: View {
    let license: LicenseState

    var body: some View {
        switch license {
        case .active:
            EmptyView()
        case .demo(let remaining):
            banner(remaining == 1 ? "Modo demonstração · 1 impressão restante"
                                  : "Modo demonstração · \(remaining) impressões restantes",
                   color: .orange, icon: "sparkles")
        case .expired:
            banner("Assinatura vencida. Atendente: toque em Configurações.", color: .red, icon: "lock.fill")
        case .demoOver:
            banner("Demonstração encerrada. Atendente: toque em Configurações para assinar.", color: .red, icon: "lock.fill")
        }
    }

    private func banner(_ text: String, color: Color, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.headline)
            .foregroundStyle(color)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .background(color.opacity(0.12), in: Capsule())
    }
}

/// The store's Wi-Fi, so customers can connect their phone by pointing the camera.
struct WiFiCard: View {
    let name: String
    let password: String

    var body: some View {
        HStack(spacing: 24) {
            QRCodeView(payload: WiFiQR.payload(name: name, password: password))
                .frame(width: 150, height: 150)
                .padding(12)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 16))

            VStack(alignment: .leading, spacing: 8) {
                Label("Wi-Fi grátis da loja", systemImage: "wifi")
                    .font(.title2.weight(.bold))
                Text("Aponte a câmera do celular para o código e toque para conectar.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                Text("Rede: \(name)")
                    .font(.headline)
                if !password.isEmpty {
                    Text("Senha: \(password)")
                        .font(.headline)
                }
            }
            .frame(maxWidth: 360, alignment: .leading)
        }
        .padding(20)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24))
    }
}

// MARK: - Select

struct SelectView: View {
    @EnvironmentObject private var store: KioskStore

    init() {}
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var showFileImporter = false

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 16)]

    @ViewBuilder
    private var sourceButtons: some View {
        PhotosPicker(
            selection: $photoSelection,
            maxSelectionCount: max(1, store.remainingSlots),
            matching: .images
        ) {
            SourceTile(title: "Fotos", systemImage: "photo.on.rectangle.angled")
        }
        .disabled(store.remainingSlots == 0)

        Button { showFileImporter = true } label: {
            SourceTile(title: "Arquivos PDF", systemImage: "doc.richtext")
        }
        .disabled(store.remainingSlots == 0)

        Button { store.openPhoneUpload() } label: {
            SourceTile(title: "Do celular", systemImage: "iphone.and.arrow.forward")
        }
        .disabled(store.remainingSlots == 0)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            KioskHeader(
                title: "Escolha o que imprimir",
                subtitle: "\(store.items.count) de \(store.settings.maxItems) itens adicionados"
            )

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 20) { sourceButtons }
                VStack(spacing: 12) { sourceButtons }
            }

            if store.items.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "tray")
                        .font(.system(size: 48))
                        .foregroundStyle(.secondary)
                    Text("Nada adicionado ainda. Escolha fotos ou arquivos PDF acima.")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 20) {
                        ForEach(store.items) { item in
                            ItemTile(item: item) { store.remove(item) }
                        }
                    }
                    .padding(.vertical, 8)
                }
            }
            HStack {
                Button("Recomeçar") { store.reset() }
                    .buttonStyle(SecondaryButtonStyle())
                Spacer()
                Button("Continuar") { store.step = .review }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(store.items.isEmpty)
            }
        }
        .kioskPadding(40)
        .overlay {
            if store.isLoading {
                ProgressView("Carregando fotos…")
                    .font(.title3)
                    .padding(32)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            }
        }
        .onChange(of: photoSelection) { _, newValue in
            guard !newValue.isEmpty else { return }
            Task {
                await store.addPhotos(newValue)
                photoSelection = []
            }
        }
        .fullScreenCover(isPresented: Binding(
            get: { store.phoneUpload != nil },
            set: { if !$0 { store.closePhoneUpload() } }
        )) {
            PhoneUploadView().environmentObject(store)
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.pdf],
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls):
                for url in urls { store.addDocument(at: url) }
            case .failure:
                store.notice = "Não foi possível abrir esses arquivos."
            }
        }
    }
}

// MARK: - Review

struct ReviewView: View {
    @EnvironmentObject private var store: KioskStore

    init() {}

    private var copiesStepper: some View {
        HStack(spacing: 16) {
            Text("Cópias")
                .font(.title2.weight(.semibold))

            Button { store.copies -= 1 } label: {
                Image(systemName: "minus.circle.fill").font(.system(size: 44))
            }
            .disabled(store.copies <= 1)
            .accessibilityLabel("Menos cópias")

            Text("\(store.copies)")
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .monospacedDigit()
                .frame(minWidth: 56)

            Button { store.copies += 1 } label: {
                Image(systemName: "plus.circle.fill").font(.system(size: 44))
            }
            .disabled(store.copies >= store.settings.maxCopies)
            .accessibilityLabel("Mais cópias")
        }
    }

    private func totals(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 4) {
            Text(store.totalPages == 1 ? "1 página" : "\(store.totalPages) páginas")
                .font(.title3)
                .foregroundStyle(.secondary)
            if store.requiresPayment {
                Text(Money.format(cents: store.amountCents))
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .monospacedDigit()
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            KioskHeader(
                title: "Confira sua impressão",
                subtitle: store.settings.printerName.map { "Impressora: \($0)" } ?? "Nenhuma impressora configurada"
            )

            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 16)], spacing: 16) {
                    ForEach(store.items) { ItemTile(item: $0) }
                }
                .padding(.vertical, 4)
            }

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 24) {
                    copiesStepper
                    Spacer()
                    totals(alignment: .trailing)
                }
                VStack(alignment: .leading, spacing: 16) {
                    copiesStepper
                    totals(alignment: .leading)
                }
            }
            .padding(24)
            .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 18))

            HStack {
                Button("Voltar") { store.step = .select }
                    .buttonStyle(SecondaryButtonStyle())
                Spacer()
                Button {
                    store.checkout()
                } label: {
                    if store.requiresPayment && store.paidPaymentID == nil {
                        Label("Pagar com Pix", systemImage: "qrcode")
                    } else {
                        Label("Imprimir", systemImage: "printer.fill")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
        .kioskPadding(40)
    }
}

// MARK: - Payment

struct PaymentView: View {
    @EnvironmentObject private var store: KioskStore

    init() {}

    var body: some View {
        Group {
            switch store.paymentState {
            case .preparing:
                VStack(spacing: 24) {
                    ProgressView().scaleEffect(2.2).padding(.bottom, 16)
                    Text("Preparando o pagamento…")
                        .font(.largeTitle.bold())
                }

            case .waiting(let charge):
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: 56) {
                        qrPanel(charge)
                        instructions(charge)
                    }
                    VStack(spacing: 32) {
                        qrPanel(charge)
                        instructions(charge)
                    }
                }

            case .expired:
                PaymentMessage(
                    systemImage: "clock.badge.xmark",
                    title: "O QR Code expirou",
                    message: "Nenhum valor foi cobrado. Gere um novo QR Code para tentar de novo."
                ) {
                    Button("Recomeçar") { store.reset() }
                        .buttonStyle(SecondaryButtonStyle())
                    Button("Gerar novo QR Code") { store.checkout() }
                        .buttonStyle(PrimaryButtonStyle())
                }

            case .failed(let message):
                PaymentMessage(
                    systemImage: "exclamationmark.triangle.fill",
                    title: "Não foi possível concluir o pagamento",
                    message: message
                ) {
                    Button("Voltar") { store.step = .review }
                        .buttonStyle(SecondaryButtonStyle())
                    Button("Tentar de novo") { store.checkout() }
                        .buttonStyle(PrimaryButtonStyle())
                }
            }
        }
        .kioskPadding(48)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func qrPanel(_ charge: PixCharge) -> some View {
        QRCodeView(payload: charge.qrCode)
            .frame(maxWidth: 340, maxHeight: 340)
            .aspectRatio(1, contentMode: .fit)
            .padding(20)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 24))
            .shadow(color: .black.opacity(0.08), radius: 16, y: 6)
    }

    private func instructions(_ charge: PixCharge) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Pague com Pix")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                Text(Money.format(cents: charge.amountCents))
                    .font(.system(size: 56, weight: .heavy, design: .rounded))
                    .minimumScaleFactor(0.6)
                    .monospacedDigit()
                    .foregroundStyle(.tint)
            }

            VStack(alignment: .leading, spacing: 12) {
                Label("Abra o app do seu banco", systemImage: "1.circle.fill")
                Label("Escolha Pix › Pagar com QR Code", systemImage: "2.circle.fill")
                Label("Aponte a câmera e confirme", systemImage: "3.circle.fill")
            }
            .font(.title3)

            HStack(spacing: 12) {
                ProgressView()
                Text("Aguardando pagamento")
                if let deadline = store.paymentDeadline {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(Self.remaining(until: deadline, from: context.date))
                            .monospacedDigit()
                    }
                }
            }
            .font(.headline)
            .foregroundStyle(.secondary)

            Text("A impressão começa sozinha assim que o pagamento for confirmado.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Button("Cancelar") { store.cancelPayment() }
                .buttonStyle(SecondaryButtonStyle())
        }
        .frame(maxWidth: 420, alignment: .leading)
    }

    private static func remaining(until deadline: Date, from now: Date) -> String {
        let seconds = max(0, Int(deadline.timeIntervalSince(now)))
        return String(format: "· %d:%02d", seconds / 60, seconds % 60)
    }
}

struct PaymentMessage<Actions: View>: View {
    let systemImage: String
    let title: String
    let message: String
    @ViewBuilder let actions: Actions

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: systemImage)
                .font(.system(size: 96))
                .foregroundStyle(.orange)
            Text(title)
                .font(.largeTitle.bold())
                .multilineTextAlignment(.center)
            Text(message)
                .font(.title3)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 560)
            HStack(spacing: 20) { actions }
                .padding(.top, 8)
        }
    }
}

/// Renders the Pix "copia e cola" payload as a QR Code on the device.
struct QRCodeView: View {
    let payload: String

    var body: some View {
        if let image = Self.render(payload) {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .accessibilityLabel("QR Code")
        } else {
            Image(systemName: "qrcode")
                .resizable()
                .scaledToFit()
                .foregroundStyle(.secondary)
        }
    }

    private static func render(_ payload: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?
            .transformed(by: CGAffineTransform(scaleX: 12, y: 12)),
              let cgImage = CIContext().createCGImage(output, from: output.extent)
        else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

// MARK: - Printing and result

struct PrintingView: View {
    @EnvironmentObject private var store: KioskStore

    init() {}

    var body: some View {
        VStack(spacing: 24) {
            ProgressView()
                .scaleEffect(2.2)
                .padding(.bottom, 16)
            if store.paidPaymentID != nil {
                Label("Pagamento confirmado", systemImage: "checkmark.seal.fill")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.green)
            }
            Text("Enviando para a impressora…")
                .font(.largeTitle.bold())
            if let name = store.settings.printerName {
                Text(name)
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct FinishedView: View {
    @EnvironmentObject private var store: KioskStore
    let success: Bool
    let message: String?

    var body: some View {
        VStack(spacing: 28) {
            Image(systemName: success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .font(.system(size: 110))
                .foregroundStyle(success ? Color.green : Color.orange)

            Text(success ? "Enviado para a impressora" : "Não foi possível imprimir")
                .font(.largeTitle.bold())

            Text(success
                 ? "Retire suas páginas na impressora. Esta tela volta ao início em alguns segundos."
                 : (message ?? "Algo deu errado. Tente de novo."))
                .font(.title3)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 560)

            if !success, let paymentID = store.paidPaymentID {
                Text("Seu pagamento foi recebido e você não será cobrado de novo ao tentar outra vez. Se a impressão não sair, mostre este código a um atendente: \(String(paymentID))")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 560)
                    .padding(20)
                    .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 16))
            }

            HStack(spacing: 20) {
                if success {
                    Button("Concluir") { store.reset() }
                        .buttonStyle(PrimaryButtonStyle())
                } else {
                    Button("Recomeçar") { store.reset() }
                        .buttonStyle(SecondaryButtonStyle())
                    Button("Tentar de novo") { store.sendToPrinter() }
                        .buttonStyle(PrimaryButtonStyle())
                }
            }
            .padding(.top, 8)
        }
        .kioskPadding(48)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            guard success else { return }
            try? await Task.sleep(nanoseconds: 12_000_000_000)
            if !Task.isCancelled { store.reset() }
        }
    }
}

// MARK: - Files from the phone

struct PhoneUploadView: View {
    @EnvironmentObject private var store: KioskStore

    init() {}

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    Text("Fotos e PDFs chegam aqui pela rede Wi-Fi da loja, sem cabo e sem aplicativo.")
                        .font(.title3)
                        .foregroundStyle(.secondary)

                    switch store.phoneUpload {
                    case .ready(let url):
                        readyContent(url: url)
                    case .unavailable(let message):
                        Label(message, systemImage: "wifi.exclamationmark")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(.orange)
                    default:
                        ProgressView("Preparando…")
                            .font(.title3)
                            .frame(maxWidth: .infinity)
                    }

                    receivedRow
                }
                .kioskPadding(32)
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Envie do seu celular")
            .navigationBarTitleDisplayMode(.inline)
        }
        .interactiveDismissDisabled()
    }

    private var wifiName: String {
        store.settings.wifiName.trimmingCharacters(in: .whitespaces)
    }

    @ViewBuilder
    private func readyContent(url: String) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 28) { steps(url: url) }
            VStack(spacing: 28) { steps(url: url) }
        }
        .frame(maxWidth: .infinity)

        if wifiName.isEmpty {
            Text("O celular precisa estar no mesmo Wi-Fi deste aparelho.")
                .font(.title3)
                .foregroundStyle(.secondary)
        }
        Text("No celular, toque em Escolher fotos ou PDF. Os arquivos aparecem aqui na hora.")
            .font(.title3)
        Text("Endereço: \(url)")
            .font(.callout)
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
    }

    @ViewBuilder
    private func steps(url: String) -> some View {
        if !wifiName.isEmpty {
            QRStep(
                number: 1,
                title: "Entre no Wi-Fi",
                caption: "Rede \(wifiName)",
                payload: WiFiQR.payload(name: wifiName, password: store.settings.wifiPassword)
            )
        }
        QRStep(
            number: wifiName.isEmpty ? 1 : 2,
            title: "Abra a página de envio",
            caption: "Aponte a câmera do celular para o código",
            payload: url
        )
    }

    private var receivedRow: some View {
        HStack {
            if store.phoneReceivedCount > 0 {
                Label(
                    store.phoneReceivedCount == 1 ? "1 arquivo recebido" : "\(store.phoneReceivedCount) arquivos recebidos",
                    systemImage: "checkmark.circle.fill"
                )
                .font(.title3.weight(.semibold))
                .foregroundStyle(.green)
            } else if case .ready = store.phoneUpload {
                Label("Aguardando arquivos…", systemImage: "hourglass")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Concluir") { store.closePhoneUpload() }
                .buttonStyle(PrimaryButtonStyle())
        }
    }
}

struct QRStep: View {
    let number: Int
    let title: String
    let caption: String
    let payload: String

    var body: some View {
        VStack(spacing: 12) {
            Text("\(number). \(title)")
                .font(.title2.weight(.semibold))
                .multilineTextAlignment(.center)
            QRCodeView(payload: payload)
                .frame(width: 280, height: 280)
                .padding(16)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 20))
            Text(caption)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: 300)
    }
}

/// Text for a Wi-Fi QR Code; phone cameras offer to join the network when they read it.
enum WiFiQR {
    static func payload(name: String, password: String) -> String {
        func escape(_ value: String) -> String {
            var result = ""
            for character in value {
                if "\\;,:\"".contains(character) { result.append("\\") }
                result.append(character)
            }
            return result
        }
        if password.isEmpty {
            return "WIFI:T:nopass;S:\(escape(name));;"
        }
        return "WIFI:T:WPA;S:\(escape(name));P:\(escape(password));;"
    }
}

// MARK: - Components

struct KioskHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 40, weight: .bold, design: .rounded))
            Text(subtitle)
                .font(.title3)
                .foregroundStyle(.secondary)
        }
    }
}

struct SourceTile: View {
    let title: String
    let systemImage: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 34))
            Text(title)
                .font(.title3.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.vertical, 22)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
        .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 18))
        .foregroundStyle(.tint)
    }
}

struct ItemTile: View {
    let item: PrintItem
    var onRemove: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 8) {
            Image(uiImage: item.thumbnail)
                .resizable()
                .scaledToFit()
                .frame(height: 160)
                .frame(maxWidth: .infinity)
                .background(Color(uiColor: .secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            Text(item.name)
                .font(.subheadline.weight(.medium))
                .lineLimit(1)
            Text(item.pageCount == 1 ? "1 página" : "\(item.pageCount) páginas")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 14))
        .overlay(alignment: .topTrailing) {
            if let onRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 30))
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .red)
                }
                .offset(x: 8, y: -8)
                .accessibilityLabel("Remover \(item.name)")
            }
        }
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.horizontalSizeClass) private var sizeClass

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.title2.weight(.semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .foregroundStyle(.white)
            .padding(.horizontal, sizeClass == .compact ? 24 : 44)
            .padding(.vertical, sizeClass == .compact ? 16 : 20)
            .background(
                Color.accentColor.opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.35),
                in: Capsule()
            )
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.horizontalSizeClass) private var sizeClass

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.title3.weight(.semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .foregroundStyle(.tint)
            .padding(.horizontal, sizeClass == .compact ? 20 : 32)
            .padding(.vertical, sizeClass == .compact ? 14 : 18)
            .background(
                Color(uiColor: .systemBackground).opacity(configuration.isPressed ? 0.6 : 1),
                in: Capsule()
            )
    }
}


// MARK: - Adaptive layout

/// Generous margins on iPad, tighter margins on iPhone.
private struct KioskPadding: ViewModifier {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let regular: CGFloat

    func body(content: Content) -> some View {
        content.padding(sizeClass == .compact ? 20 : regular)
    }
}

extension View {
    func kioskPadding(_ regular: CGFloat) -> some View {
        modifier(KioskPadding(regular: regular))
    }
}
