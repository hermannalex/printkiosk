# PrintKiosk — XEROX AUTO SERVIÇO

Estação de impressão self-service para a loja. O cliente escolhe fotos ou PDFs (no aparelho do quiosque ou enviando do próprio celular pelo QR Code), define as cópias, paga com Pix e imprime.

| Pasta | Plataforma | Tecnologia |
| --- | --- | --- |
| [`ios/`](ios) | iPad e iPhone (iOS 17+) | SwiftUI, AirPrint, Network.framework |
| [`android/`](android) | Tablet Android (8.0+) | Kotlin, Jetpack Compose, Android Print |

## Funcionalidades

- Tela inicial "XEROX / AUTO SERVIÇO / Imprima aqui por R$ X,XX" com QR Code do Wi-Fi da loja
- Fotos e PDFs do próprio aparelho, ou **Do celular**: o quiosque mostra um QR Code, o cliente abre uma página pelo Wi-Fi da loja e envia os arquivos (servidor local, sem nuvem, limite de 50 MB por arquivo)
- Cópias com total de páginas e valor em reais
- Pix pelo Mercado Pago com QR Code dinâmico e confirmação automática, sem cobrar duas vezes em caso de falha na impressão
- Volta ao início por inatividade
- Configurações protegidas por PIN (padrão 1234): impressora, preço por página, token do Mercado Pago, Wi-Fi da loja (SSID e senha), limites e tempos
- Token do Mercado Pago guardado criptografado no aparelho (Keychain / Android Keystore), nunca no código

## Compilar

- **iOS:** abra `ios/PrintKiosk.xcodeproj` no Xcode 27, escolha seu Team em *Signing & Capabilities* e rode (⌘R). Detalhes em [`ios/README.md`](ios/README.md).
- **Android:** abra a pasta `android/` no Android Studio, espere o Gradle Sync e rode, ou gere o APK em *Build › Generate App Bundles or APKs › Generate APKs*. Detalhes em [`android/README.md`](android/README.md).

## Configuração na loja

1. Na tela inicial, toque em **Configurações** e digite o PIN **1234** (troque-o em seguida).
2. Escolha a impressora (iOS) ou imprima uma página de teste (Android).
3. Preencha o **Wi-Fi da loja**, o **preço por página** e, para cobrar, o e-mail da loja e o **Access Token de produção** do Mercado Pago.
4. Para o envio pelo celular, o quiosque e os celulares dos clientes precisam estar no mesmo Wi-Fi, sem isolamento de clientes no roteador.
