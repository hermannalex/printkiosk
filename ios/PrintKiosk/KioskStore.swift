import SwiftUI
import PhotosUI
import PDFKit

// MARK: - Models

struct PrintItem: Identifiable {
    enum Content {
        case image(UIImage)
        case pdf(URL, pageCount: Int)
    }

    let id = UUID()
    let content: Content
    let thumbnail: UIImage
    let name: String

    var pageCount: Int {
        switch content {
        case .image: return 1
        case .pdf(_, let count): return count
        }
    }

    /// UIPrintInteractionController accepts UIImage, URL, or Data.
    var printingItem: Any {
        switch content {
        case .image(let image): return image
        case .pdf(let url, _): return url
        }
    }

    var isPhoto: Bool {
        if case .image = content { return true }
        return false
    }
}

enum KioskStep: Equatable {
    case welcome
    case select
    case review
    case payment
    case printing
    case finished(success: Bool, message: String?)
}

/// The "Do celular" panel: customers send files from their phone over the store's Wi-Fi.
enum PhoneUploadState: Equatable {
    case starting
    case ready(String)
    case unavailable(String)
}

enum PaymentState: Equatable {
    case preparing
    case waiting(PixCharge)
    case expired
    case failed(String)
}

struct KioskSettings: Codable, Equatable {
    var kioskName = "Estação de Impressão"
    var adminPIN = "1234"
    var idleTimeoutSeconds = 90
    var maxCopies = 10
    var maxItems = 20
    var printerURL: URL?
    var printerName: String?
    /// 0 means printing is free and the Pix step is skipped.
    var pricePerPageCents = 0
    /// Mercado Pago requires a payer e-mail on every Pix charge; the store's own e-mail works.
    var payerEmail = ""
    var paymentTimeoutSeconds = 300
    /// Optional guest Wi-Fi shown as a QR Code, so customers' phones can join before sending files.
    var wifiName = ""
    var wifiPassword = ""

    init() {}

    /// Reads each key on its own, so settings saved by an older version keep working.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let defaults = KioskSettings()
        kioskName = try container.decodeIfPresent(String.self, forKey: .kioskName) ?? defaults.kioskName
        adminPIN = try container.decodeIfPresent(String.self, forKey: .adminPIN) ?? defaults.adminPIN
        idleTimeoutSeconds = try container.decodeIfPresent(Int.self, forKey: .idleTimeoutSeconds) ?? defaults.idleTimeoutSeconds
        maxCopies = try container.decodeIfPresent(Int.self, forKey: .maxCopies) ?? defaults.maxCopies
        maxItems = try container.decodeIfPresent(Int.self, forKey: .maxItems) ?? defaults.maxItems
        printerURL = try container.decodeIfPresent(URL.self, forKey: .printerURL)
        printerName = try container.decodeIfPresent(String.self, forKey: .printerName)
        pricePerPageCents = try container.decodeIfPresent(Int.self, forKey: .pricePerPageCents) ?? defaults.pricePerPageCents
        payerEmail = try container.decodeIfPresent(String.self, forKey: .payerEmail) ?? defaults.payerEmail
        paymentTimeoutSeconds = try container.decodeIfPresent(Int.self, forKey: .paymentTimeoutSeconds) ?? defaults.paymentTimeoutSeconds
        wifiName = try container.decodeIfPresent(String.self, forKey: .wifiName) ?? defaults.wifiName
        wifiPassword = try container.decodeIfPresent(String.self, forKey: .wifiPassword) ?? defaults.wifiPassword
    }

    private static let storageKey = "kiosk.settings"

    static func load() -> KioskSettings {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let settings = try? JSONDecoder().decode(KioskSettings.self, from: data)
        else { return KioskSettings() }
        return settings
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) {
            UserDefaults.standard.set(data, forKey: Self.storageKey)
        }
    }
}

// MARK: - Store

@MainActor
final class KioskStore: ObservableObject {
    static let mercadoPagoTokenKey = "mercadopago.accessToken"

    @Published var step: KioskStep = .welcome
    @Published private(set) var items: [PrintItem] = []
    @Published var copies = 1
    @Published var isLoading = false
    @Published var notice: String?
    @Published var showAdmin = false
    @Published var settings = KioskSettings.load() {
        didSet { settings.save() }
    }

    // Payment
    @Published private(set) var paymentState: PaymentState = .preparing
    @Published private(set) var paymentDeadline: Date?
    /// Set once the customer has paid, so a retry after a printer error never charges twice.
    @Published private(set) var paidPaymentID: Int64?
    // Subscription / demo
    @Published private(set) var license = License.state()
    let storeCode = License.storeCode(License.storeID)

    // Online dashboard
    let cloud = CloudSync()
    @Published private(set) var lastSync: Date?
    @Published private(set) var syncError: String?
    private var syncTimer: Timer?

    // Files sent from the customer's phone
    @Published private(set) var phoneUpload: PhoneUploadState?
    @Published private(set) var phoneReceivedCount = 0
    private var uploadServer: UploadServer?

    private var activeCharge: PixCharge?
    private var paymentTask: Task<Void, Never>?

    private var lastInteraction = Date()
    private var idleTimer: Timer?
    private let printService = PrintService()
    let jobDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent("KioskJobs", isDirectory: true)

    init() {
        clearJobFiles()
        idleTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.checkIdle() }
        }
        lastSync = cloud.lastSync
        syncTimer = Timer.scheduledTimer(withTimeInterval: 30 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.syncWithDashboard() }
        }
        Task { await syncWithDashboard() }
    }

    // MARK: Online dashboard

    /// Sends the print history and applies a newer activation code from the dashboard.
    func syncWithDashboard() async {
        refreshLicense()
        guard let response = await cloud.sync(storeCode: storeCode, license: license) else { return }
        if let error = response.error {
            syncError = error
            return
        }
        syncError = nil
        lastSync = cloud.lastSync
        if let code = response.activationCode, let until = License.verify(code: code, storeID: License.storeID) {
            let current: Int? = {
                if case .active(let date) = license { return License.dayNumber(date) }
                return nil
            }()
            if current == nil || until > current! {
                _ = License.activate(code: code)
                refreshLicense()
            }
        }
    }

    private func recordPrint(success: Bool, demo: Bool) {
        let pages = items.reduce(0) { $0 + $1.pageCount }
        cloud.record(PrintJobRecord(
            id: UUID().uuidString,
            printedAt: CloudSync.isoNow(),
            items: items.count,
            pages: pages,
            copies: copies,
            totalPages: pages * copies,
            amountCents: paidPaymentID != nil ? amountCents : 0,
            paidWithPix: paidPaymentID != nil,
            pixPaymentId: paidPaymentID.map(String.init),
            success: success,
            demo: demo
        ))
        Task { await syncWithDashboard() }
    }

    // MARK: Derived values

    var totalPages: Int { items.reduce(0) { $0 + $1.pageCount } * copies }
    var amountCents: Int { totalPages * settings.pricePerPageCents }
    var requiresPayment: Bool { settings.pricePerPageCents > 0 }
    var remainingSlots: Int { max(0, settings.maxItems - items.count) }
    var isPrinterConfigured: Bool { settings.printerURL != nil }
    var isPixConfigured: Bool {
        settings.payerEmail.contains("@") && !(Keychain.get(Self.mercadoPagoTokenKey) ?? "").isEmpty
    }

    // MARK: Session flow

    func registerInteraction() {
        lastInteraction = Date()
    }

    func start() {
        registerInteraction()
        refreshLicense()
        guard license.canPrint else {
            notice = blockedMessage
            return
        }
        step = .select
    }

    func reset() {
        closePhoneUpload()
        paymentTask?.cancel()
        paymentTask = nil
        if let charge = activeCharge, let token = Keychain.get(Self.mercadoPagoTokenKey) {
            Task { try? await PixService(accessToken: token).cancel(charge.id) }
        }
        activeCharge = nil
        paymentDeadline = nil
        paidPaymentID = nil
        paymentState = .preparing

        items.removeAll()
        copies = 1
        notice = nil
        step = .welcome
        clearJobFiles()
    }

    private func checkIdle() {
        switch step {
        case .welcome, .printing:
            return
        case .payment:
            // Never reset while a customer may be paying on their phone.
            switch paymentState {
            case .preparing, .waiting: return
            default: break
            }
        default:
            break
        }
        guard !showAdmin else { return }
        // Give customers more time while they pick files on their phone.
        let timeout = phoneUpload != nil ? max(settings.idleTimeoutSeconds, 300) : settings.idleTimeoutSeconds
        if Date().timeIntervalSince(lastInteraction) > Double(timeout) {
            reset()
        }
    }

    // MARK: Adding and removing items

    func remove(_ item: PrintItem) {
        items.removeAll { $0.id == item.id }
    }

    func addPhotos(_ selection: [PhotosPickerItem]) async {
        isLoading = true
        defer { isLoading = false }

        var failed = 0
        for pick in selection.prefix(remainingSlots) {
            guard let data = try? await pick.loadTransferable(type: Data.self),
                  let image = UIImage(data: data)
            else {
                failed += 1
                continue
            }
            let thumbnail = await Self.makeThumbnail(for: image)
            items.append(PrintItem(content: .image(image), thumbnail: thumbnail, name: "Foto \(items.count + 1)"))
        }

        if failed > 0 {
            notice = failed == 1 ? "1 foto não pôde ser carregada." : "\(failed) fotos não puderam ser carregadas."
        }
    }

    func addDocument(at url: URL) {
        guard remainingSlots > 0 else {
            notice = "Você atingiu o limite de \(settings.maxItems) itens por impressão."
            return
        }

        // Files picked from the Files app are security-scoped.
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }

        do {
            try FileManager.default.createDirectory(at: jobDirectory, withIntermediateDirectories: true)
            let copy = jobDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
            try FileManager.default.copyItem(at: url, to: copy)

            guard let document = PDFDocument(url: copy), document.pageCount > 0 else {
                notice = "\(url.lastPathComponent) não é um PDF válido."
                return
            }
            guard !document.isLocked else {
                notice = "\(url.lastPathComponent) tem senha. Remova a senha e tente de novo."
                return
            }

            let thumbnail = document.page(at: 0)?
                .thumbnail(of: CGSize(width: 300, height: 400), for: .mediaBox) ?? UIImage()
            items.append(PrintItem(
                content: .pdf(copy, pageCount: document.pageCount),
                thumbnail: thumbnail,
                name: url.deletingPathExtension().lastPathComponent
            ))
        } catch {
            notice = "Não foi possível abrir \(url.lastPathComponent)."
        }
    }

    // MARK: Subscription

    func refreshLicense() {
        license = License.state()
    }

    var isSubscribed: Bool {
        if case .active = license { return true }
        return false
    }

    /// Checks and saves a monthly activation code; returns a message for the staff screen.
    func activateLicense(code: String) -> String {
        guard let until = License.activate(code: code) else {
            return "Código inválido para esta loja. Confira se copiou o código inteiro, começando por PK1-."
        }
        refreshLicense()
        let date = License.date(dayNumber: until).formatted(date: .numeric, time: .omitted)
        if case .active = license { return "Assinatura ativa até \(date)." }
        return "Este código venceu em \(date)."
    }

    private var blockedMessage: String {
        if case .expired = license {
            return "A assinatura deste quiosque venceu. Peça ajuda a um atendente."
        }
        return "A demonstração terminou (\(License.demoPrints) impressões). Peça ajuda a um atendente."
    }

    // MARK: Files from the customer's phone

    /// Opens the "Do celular" panel and starts the upload page on the store's Wi-Fi.
    func openPhoneUpload() {
        registerInteraction()
        closePhoneUpload()
        phoneReceivedCount = 0

        guard let ip = UploadServer.localIPAddress() else {
            phoneUpload = .unavailable("Este aparelho não está conectado a uma rede Wi-Fi. Conecte-o ao Wi-Fi da loja e tente de novo.")
            return
        }

        let token = Self.randomToken()
        let server = UploadServer(token: token, page: uploadPage(), directory: jobDirectory) { [weak self] file, name, mimeType, completion in
            Task { @MainActor in
                guard let self else {
                    completion(UploadResult(ok: false, message: "O quiosque não está pronto."))
                    return
                }
                completion(await self.receiveUpload(file: file, name: name, mimeType: mimeType))
            }
        }
        uploadServer = server
        phoneUpload = .starting

        server.start { [weak self] port in
            Task { @MainActor in
                guard let self, self.uploadServer === server else {
                    server.stop()
                    return
                }
                if let port {
                    self.phoneUpload = .ready("http://\(ip):\(port)/u/\(token)")
                } else {
                    self.uploadServer = nil
                    server.stop()
                    self.phoneUpload = .unavailable("Não foi possível abrir o recebimento de arquivos. Tente de novo.")
                }
            }
        }
    }

    func closePhoneUpload() {
        uploadServer?.stop()
        uploadServer = nil
        phoneUpload = nil
    }

    /// Adds a file the phone sent. The result goes back to the phone's page.
    private func receiveUpload(file: URL, name: String, mimeType: String) async -> UploadResult {
        registerInteraction()

        func reject(_ message: String) -> UploadResult {
            try? FileManager.default.removeItem(at: file)
            return UploadResult(ok: false, message: message)
        }

        guard uploadServer != nil else { return reject("O recebimento foi encerrado no quiosque.") }
        guard remainingSlots > 0 else { return reject("Limite de \(settings.maxItems) itens atingido no quiosque.") }

        let fileExtension = (name as NSString).pathExtension.lowercased()

        if mimeType == "application/pdf" || fileExtension == "pdf" {
            let title = (name as NSString).deletingPathExtension
            guard let document = PDFDocument(url: file), document.pageCount > 0 else {
                return reject("\(name) não é um PDF válido.")
            }
            guard !document.isLocked else {
                return reject("\(name) tem senha. Remova a senha e tente de novo.")
            }
            let thumbnail = document.page(at: 0)?
                .thumbnail(of: CGSize(width: 300, height: 400), for: .mediaBox) ?? UIImage()
            items.append(PrintItem(
                content: .pdf(file, pageCount: document.pageCount),
                thumbnail: thumbnail,
                name: title.isEmpty ? "Documento \(items.count + 1)" : title
            ))
            phoneReceivedCount += 1
            return UploadResult(ok: true, message: "Enviado")
        }

        if mimeType.hasPrefix("image/") || Self.imageExtensions.contains(fileExtension) {
            guard let image = UIImage(contentsOfFile: file.path) else {
                return reject("Esta foto não pôde ser lida. Tente outra foto.")
            }
            let thumbnail = await Self.makeThumbnail(for: image)
            items.append(PrintItem(content: .image(image), thumbnail: thumbnail, name: "Foto \(items.count + 1)"))
            phoneReceivedCount += 1
            return UploadResult(ok: true, message: "Enviado")
        }

        return reject("Envie apenas fotos ou arquivos PDF.")
    }

    private func uploadPage() -> String {
        let html: String
        if let url = Bundle.main.url(forResource: "upload", withExtension: "html"),
           let text = try? String(contentsOf: url, encoding: .utf8) {
            html = text
        } else {
            html = "<!doctype html><meta charset=utf-8><p>Página de envio indisponível.</p>"
        }
        let name = settings.kioskName
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
        return html.replacingOccurrences(of: "{{KIOSK}}", with: name)
    }

    private static let imageExtensions: Set<String> = ["jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "bmp", "tif", "tiff"]

    private static func randomToken() -> String {
        let alphabet = Array("abcdefghijkmnpqrstuvwxyz23456789")
        return String((0..<10).map { _ in alphabet.randomElement()! })
    }

    // MARK: Checkout

    /// Called by the Print / Pay button on the review screen.
    func checkout() {
        refreshLicense()
        guard license.canPrint || paidPaymentID != nil else {
            step = .finished(success: false, message: blockedMessage)
            return
        }
        guard let printerURL = settings.printerURL else {
            step = .finished(success: false, message: "Nenhuma impressora está configurada. Peça ajuda a um atendente.")
            return
        }

        guard requiresPayment, paidPaymentID == nil else {
            sendToPrinter()
            return
        }

        guard isPixConfigured, let token = Keychain.get(Self.mercadoPagoTokenKey) else {
            step = .finished(success: false, message: "O pagamento por Pix ainda não foi configurado. Peça ajuda a um atendente.")
            return
        }

        registerInteraction()
        step = .payment
        paymentState = .preparing
        paymentTask?.cancel()
        paymentTask = Task { await runPayment(token: token, printerURL: printerURL) }
    }

    private func runPayment(token: String, printerURL: URL) async {
        // Check the printer first, so nobody pays for a job that can't print.
        guard await printService.isReachable(printerURL) else {
            paymentState = .failed("A impressora não está respondendo, então nenhuma cobrança foi feita. Peça ajuda a um atendente.")
            return
        }
        guard !Task.isCancelled else { return }

        let pix = PixService(accessToken: token)
        let charge: PixCharge
        do {
            charge = try await pix.createCharge(
                amountCents: amountCents,
                description: "\(settings.kioskName) – \(totalPages) página(s)",
                payerEmail: settings.payerEmail
            )
        } catch {
            paymentState = .failed(error.localizedDescription)
            return
        }

        guard !Task.isCancelled else {
            try? await pix.cancel(charge.id)
            return
        }

        activeCharge = charge
        paymentDeadline = Date().addingTimeInterval(TimeInterval(settings.paymentTimeoutSeconds))
        paymentState = .waiting(charge)

        // Poll every 3 seconds until paid, refused, or out of time.
        while let deadline = paymentDeadline, Date() < deadline, !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            guard let status = try? await pix.status(of: charge.id) else { continue } // ignore a brief network blip

            if status == .approved {
                paymentApproved(charge)
                return
            }
            if status.isFinalFailure {
                activeCharge = nil
                paymentDeadline = nil
                paymentState = .failed("O pagamento foi recusado ou cancelado. Nenhum valor foi cobrado.")
                return
            }
        }
        guard !Task.isCancelled else { return }

        // Time is up. Check one last time in case the payment landed at the last second.
        if (try? await pix.status(of: charge.id)) == .approved {
            paymentApproved(charge)
            return
        }
        try? await pix.cancel(charge.id)
        activeCharge = nil
        paymentDeadline = nil
        paymentState = .expired
    }

    /// The customer tapped Cancel while the QR Code was showing.
    func cancelPayment() {
        paymentTask?.cancel()
        paymentTask = nil
        paymentDeadline = nil

        guard let charge = activeCharge, let token = Keychain.get(Self.mercadoPagoTokenKey) else {
            step = .review
            return
        }

        activeCharge = nil
        paymentState = .preparing
        Task {
            let pix = PixService(accessToken: token)
            // If they paid just before tapping Cancel, print anyway instead of keeping their money.
            if (try? await pix.status(of: charge.id)) == .approved {
                paymentApproved(charge)
                return
            }
            try? await pix.cancel(charge.id)
            step = .review
        }
    }

    private func paymentApproved(_ charge: PixCharge) {
        paidPaymentID = charge.id
        activeCharge = nil
        paymentDeadline = nil
        sendToPrinter()
    }

    // MARK: Printing

    func sendToPrinter() {
        guard let printerURL = settings.printerURL else {
            step = .finished(success: false, message: "Nenhuma impressora está configurada. Peça ajuda a um atendente.")
            return
        }

        step = .printing
        let allPhotos = items.allSatisfy(\.isPhoto)

        printService.print(
            items.map(\.printingItem),
            copies: copies,
            asPhoto: allPhotos,
            printerURL: printerURL
        ) { [weak self] success, message in
            Task { @MainActor in
                guard let self else { return }
                let demo = !self.isSubscribed
                if success && demo {
                    License.recordDemoPrint()
                    self.refreshLicense()
                }
                self.recordPrint(success: success, demo: demo)
                self.step = .finished(success: success, message: message)
            }
        }
    }

    func choosePrinter() {
        printService.pickPrinter { [weak self] url, name in
            guard let url else { return }
            Task { @MainActor in
                self?.settings.printerURL = url
                self?.settings.printerName = name
            }
        }
    }

    // MARK: Helpers

    private func clearJobFiles() {
        try? FileManager.default.removeItem(at: jobDirectory)
    }

    private static func makeThumbnail(for image: UIImage) async -> UIImage {
        let longest = max(image.size.width, image.size.height)
        guard longest > 0 else { return image }
        let scale = min(1, 400 / longest)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return await image.byPreparingThumbnail(ofSize: size) ?? image
    }
}
