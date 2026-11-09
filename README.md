# PrintKiosk — XEROX AUTO SERVIÇO

Estação de impressão self-service para a loja. O cliente escolhe fotos ou PDFs (no aparelho do quiosque ou enviando do próprio celular pelo QR Code), define as cópias, paga com Pix e imprime.

| Pasta | Plataforma | Tecnologia |
| --- | --- | --- |
| [`ios/`](ios) | iPad e iPhone (iOS 17+) | SwiftUI, AirPrint, Network.framework |
| [`android/`](android) | Tablet Android (8.0+) | Kotlin, Jetpack Compose, Android Print |
| [`desktop/`](desktop) | Computador Windows 10/11 e Mac (macOS 11+) | Go (um único programa), Edge/Chrome em modo quiosque, impressão direta |

## Funcionalidades

- Tela inicial "XEROX / AUTO SERVIÇO / Imprima aqui por R$ X,XX" com QR Code do Wi-Fi da loja
- Fotos e PDFs do próprio aparelho, ou **Do celular**: o quiosque mostra um QR Code, o cliente abre uma página pelo Wi-Fi da loja e envia os arquivos (servidor local, sem nuvem, limite de 50 MB por arquivo)
- Cópias com total de páginas e valor em reais
- Pix pelo Mercado Pago com QR Code dinâmico e confirmação automática, sem cobrar duas vezes em caso de falha na impressão
- Volta ao início por inatividade
- Configurações protegidas por PIN (padrão 1234): impressora, preço por página, token do Mercado Pago, Wi-Fi da loja (SSID e senha), limites e tempos
- Pagamento por Pix, cartão e aproximação (Apple Pay, Google Pay) na maquininha Point do Mercado Pago, ou voucher de crédito criado no painel
- Token do Mercado Pago guardado criptografado no aparelho (Keychain / Android Keystore / DPAPI do Windows / Chaves do macOS), nunca no código
- **Assinatura mensal** (Básico R$ 19,99 por quiosque; Pro R$ 49,99 + R$ 9,99 por quiosque adicional), liberada por código de ativação, com **5 impressões de demonstração** por aparelho

## Compilar

- **iOS:** abra `ios/PrintKiosk.xcodeproj` no Xcode 27, escolha seu Team em *Signing & Capabilities* e rode (⌘R). Detalhes em [`ios/README.md`](ios/README.md).
- **Android:** abra a pasta `android/` no Android Studio, espere o Gradle Sync e rode, ou gere o APK em *Build › Generate App Bundles or APKs › Generate APKs*. Detalhes em [`android/README.md`](android/README.md).
- **Windows e Mac:** baixe o `imprime.ai.exe` ou o `imprime.ai-mac.zip` dos artefatos da ação *desktop* no GitHub (ou compile com Go 1.24). Detalhes em [`desktop/LEIA-ME.md`](desktop/LEIA-ME.md).

## Configuração na loja

1. Na tela inicial, toque em **Configurações** e digite o PIN **1234** (troque-o em seguida).
2. Escolha a impressora (iOS) ou imprima uma página de teste (Android).
3. Preencha o **Wi-Fi da loja**, o **preço por página** e, para cobrar, o e-mail da loja e o **Access Token de produção** do Mercado Pago.
4. Para o envio pelo celular, o quiosque e os celulares dos clientes precisam estar no mesmo Wi-Fi, sem isolamento de clientes no roteador.

## Assinatura e demonstração

Sem assinatura, cada aparelho faz **5 impressões de demonstração** (cada envio para a impressora conta 1). Depois, o app só imprime com um **código de ativação** válido.

1. Em **Configurações › Assinatura**, o aparelho mostra o **código da loja** (por exemplo `ABCD-EFGH`).
2. O dono da loja envia esse código e paga a mensalidade.
3. No Mac, gere o código de ativação:

   ```sh
   python3 tools/gerar-codigo.py ABCD-EFGH              # vale 31 dias a partir de hoje
   python3 tools/gerar-codigo.py ABCD-EFGH --ate 2026-12-31
   ```

4. Envie o código (começa com `PK1-`) para a loja. Ela cola em **Configurações › Assinatura › Ativar**.

Os códigos são assinados com ECDSA P-256. Os apps têm só a chave pública; a **chave privada** fica em `~/Documents/PrintKiosk-Licencas/printkiosk-chave-privada.pem` e **nunca** vai para o repositório. Faça backup dela: sem ela não é possível gerar novos códigos para os apps já instalados.

Preço e contato exibidos no app: `License.swift` (iOS) e `LicenseCodec.kt` (Android).

## Painel online

Endereço: https://quioco.vercel.app (código em `web/`, Next.js na Vercel + Postgres na Neon).

- **Lojas**: criam conta, adicionam o quiosque pelo código da loja (Configurações → Assinatura), assinam pelo Mercado Pago (Básico R$ 19,99/mês por quiosque; Pro R$ 49,99/mês pelo primeiro quiosque + R$ 9,99/mês por quiosque adicional, com painel) e veem impressões, cópias, páginas e faturamento.
- **Master**: conta com o e-mail `MASTER_EMAIL`, criada em `/cadastro` com o `MASTER_SETUP_CODE`. Vê todas as lojas, gera códigos de ativação, registra pagamentos manuais, muda plano e bloqueia contas.
- **Apps**: enviam as impressões para `/api/kiosk/sync` ao abrir, a cada 30 minutos e após cada impressão, e aplicam sozinhos o código de ativação que o painel devolver.

Variáveis na Vercel: `DATABASE_URL`, `SESSION_SECRET`, `LICENSE_PRIVATE_KEY`, `MASTER_EMAIL`, `MASTER_SETUP_CODE`, `APP_URL`, `MERCADOPAGO_ACCESS_TOKEN`.
Webhook do Mercado Pago: `https://quioco.vercel.app/api/mp/webhook` com os eventos de assinaturas (`subscription_preapproval` e `subscription_authorized_payment`).
