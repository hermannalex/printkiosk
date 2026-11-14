import SwiftUI

/// The same code builds two apps:
/// - imprime.ai (PrintKiosk.xcodeproj): payments, license and the online dashboard.
/// - imprime-free (ImprimeFree.xcodeproj, compiled with the FREE flag): prints for free with no
///   limit, has no payments, license or dashboard, and shows house ads for imprime.ai.
enum Edition {
    #if FREE
    static let isFree = true
    #else
    static let isFree = false
    #endif

    static let adURL = "https://imprime.ai/?origem=imprime-free"
}

private struct HouseAdText {
    let title: String
    let body: String
}

private let houseAds = [
    HouseAdText(title: "Cobre pelas impressões com Pix", body: "Com o imprime.ai o cliente paga com Pix e o dinheiro cai direto na sua conta."),
    HouseAdText(title: "Painel online da loja", body: "Faturamento, páginas impressas e horários de pico de cada quiosque, de qualquer lugar."),
    HouseAdText(title: "Cartão por aproximação", body: "Aceite crédito, débito, Apple Pay e Google Pay na maquininha do Mercado Pago."),
    HouseAdText(title: "Vouchers de crédito", body: "Crie créditos de impressão para promoções, troco ou clientes fiéis."),
    HouseAdText(title: "Tem uma loja? Tenha um quiosque assim", body: "Transforme a sua impressora num autoatendimento. Baixe em imprime.ai."),
]

private let adIndigo = Color(red: 79 / 255, green: 70 / 255, blue: 229 / 255)
private let adInk = Color(red: 49 / 255, green: 46 / 255, blue: 129 / 255)

/// A rotating ad card for imprime.ai with a QR Code to the site. Empty in the paid app.
struct HouseAdView: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var index = Int.random(in: 0..<houseAds.count)
    private let timer = Timer.publish(every: 9, on: .main, in: .common).autoconnect()

    var body: some View {
        if Edition.isFree {
            let ad = houseAds[index % houseAds.count]
            HStack(spacing: 14) {
                QRCodeView(payload: Edition.adURL)
                    .frame(width: sizeClass == .compact ? 76 : 104, height: sizeClass == .compact ? 76 : 104)
                VStack(alignment: .leading, spacing: 3) {
                    Text("ANÚNCIO · IMPRIME.AI")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(ad.title)
                        .font(.headline)
                        .foregroundStyle(adInk)
                    Text(ad.body)
                        .font(.subheadline)
                        .foregroundStyle(Color(white: 0.25))
                        .fixedSize(horizontal: false, vertical: true)
                    Text("imprime.ai · 10 impressões grátis para testar")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(adIndigo)
                }
            }
            .padding(14)
            .frame(maxWidth: 600, alignment: .leading)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(red: 199 / 255, green: 210 / 255, blue: 254 / 255), lineWidth: 2))
            .onReceive(timer) { _ in index = (index + 1) % houseAds.count }
            .accessibilityElement(children: .combine)
        }
    }
}

/// Settings card in imprime-free: what this version is, and where to get the paid one.
struct FreeUpgradeCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Esta versão imprime de graça, sem limite e sem pagamento, e mostra anúncios do imprime.ai.")
            Text("Quer cobrar pelas impressões? O imprime.ai completo recebe por Pix, cartão por aproximação e vouchers, com painel online de faturamento, relatórios e ajustes à distância.")
            HStack(spacing: 14) {
                QRCodeView(payload: Edition.adURL)
                    .frame(width: 110, height: 110)
                Text("Aponte a câmera ou acesse imprime.ai para baixar. As 10 primeiras impressões são grátis.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
    }
}
