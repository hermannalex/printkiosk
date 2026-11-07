# Print Kiosk para iPad (com Pix)

Uma estação de impressão self-service:

1. O cliente toca em **Começar** e escolhe fotos ou PDFs.
2. Ele escolhe quantas cópias quer e vê o valor total.
3. Ele paga com **Pix** lendo um QR Code gerado pelo Mercado Pago.
4. Assim que o pagamento é confirmado, o iPad imprime direto numa impressora AirPrint e volta ao início.

## Funcionalidades

- Fotos (app Fotos) e PDFs (app Arquivos, incluindo iCloud Drive e pen drive)
- Seletor de cópias com total de páginas e valor em reais
- Pix com QR Code dinâmico do Mercado Pago e confirmação automática:
  - o app consulta o status a cada 3 segundos
- Proteções no pagamento:
  - Antes de cobrar, o app verifica se a impressora está respondendo, para ninguém pagar por algo que não vai imprimir.
  - QR Codes não pagos são cancelados no Mercado Pago quando o tempo acaba ou quando o cliente toca em Cancelar.
  - Se o cliente pagar e tocar em Cancelar logo em seguida, o app imprime mesmo assim.
  - Se a impressão falhar depois do pagamento, "Tentar de novo" não cobra outra vez. A tela mostra o código do pagamento para o atendente.
- Preço R$ 0,00 desativa o Pix (impressão gratuita)
- Volta ao início por inatividade (nunca enquanto o QR Code está na tela)
- Configurações protegidas por PIN:
  - impressora, preço por página, token do Mercado Pago
  - limites de cópias e de itens
  - tempos de pagamento e de inatividade
- Token guardado no Keychain do iPad, só neste aparelho e fora dos backups

## Requisitos

- Mac com chip Apple (M1 ou mais novo) com macOS Golden Gate (27) ou Tahoe 26.6+
- Xcode 27
- iPad com iPadOS 17 ou mais recente (testado para 17.6)
- Impressora AirPrint na mesma rede Wi-Fi
- Conta Mercado Pago com chave Pix cadastrada

## Montar o projeto no Xcode

1. **File › New › Project › iOS › App**. Nome `PrintKiosk`, interface **SwiftUI**, linguagem **Swift**.
2. Apague os arquivos gerados `ContentView.swift` e `PrintKioskApp.swift`.
3. Arraste os oito arquivos `.swift` desta pasta para o projeto (marque "Copy items if needed").
4. Na aba **General** do target:
   - **Supported Destinations**: só iPad.
   - **Minimum Deployments**: iOS 17.0.
5. Na aba **Info**, adicione `UIRequiresFullScreen` = `YES`.
6. Na aba **Build Settings** (filtro **All**), busque e ajuste:
   - **Swift Language Version**: Swift 5
   - **Default Actor Isolation**: nonisolated
7. Rode num iPad real. O Simulador só imprime no Printer Simulator.

## Credenciais do Mercado Pago

1. Entre no painel **Mercado Pago Developers** e crie uma aplicação.
2. Na seção de credenciais da aplicação, copie o **Access Token de produção** (começa com `APP_USR-`).
3. Confirme que a conta tem uma **chave Pix cadastrada**. Sem ela, a API recusa cobranças Pix.

## Primeira configuração no iPad

1. Na tela inicial, mantenha pressionado o **canto superior direito por 3 segundos**.
2. Digite o PIN padrão **1234** e troque-o em **PIN do atendente**.
3. Toque em **Escolher impressora…** e selecione a impressora.
4. Em **Pagamento Pix**:
   - defina o preço por página;
   - preencha o e-mail da loja;
   - cole o Access Token e toque em **Salvar token**;
   - toque em **Testar conexão**.
5. Feche as configurações.

## Testar antes de abrir ao público

O Pix nas credenciais de teste do Mercado Pago exige usuários de teste. O jeito mais simples de testar é com valor real baixo:

1. Ponha o preço em R$ 0,10.
2. Faça uma impressão e pague com seu celular.
3. Estorne o valor no painel do Mercado Pago.

## Estornos

O app não faz estornos sozinho. Se um cliente pagou e a impressão não saiu:

1. Peça o código do pagamento que aparece na tela.
2. Procure esse código no painel do Mercado Pago (Atividade).
3. Faça o estorno por lá.

## Segurança

O Access Token está no iPad, então quem conseguir extrair o token tem acesso à conta Mercado Pago pela API. Para reduzir o risco:

- use Acesso Guiado ou o Modo de App Único;
- use uma conta Mercado Pago separada só para o quiosque;
- troque o token se o iPad for perdido.

Para mais segurança, a criação da cobrança pode ir para um servidor próprio no futuro, com uma mudança só no `PixService.swift`.

## Travar o iPad no app

- **Acesso Guiado**:
  1. Em Ajustes › Acessibilidade › Acesso Guiado, ative a opção.
  2. Abra o app.
  3. Clique três vezes no botão lateral (ou de Início) e toque em Iniciar.
- **iPads gerenciados**: Modo de App Único pelo MDM.

## Arquivos

| Arquivo | Função |
| --- | --- |
| `PrintKioskApp.swift` | Entrada do app; mantém a tela acesa e instala o detector de toques |
| `KioskStore.swift` | Estado da sessão, configurações, itens, fluxo de pagamento e reinício |
| `PixService.swift` | API do Mercado Pago: criar cobrança Pix, consultar status, cancelar |
| `Keychain.swift` | Guarda o token no Keychain; formatação em reais |
| `PrintService.swift` | Impressão AirPrint, teste da impressora e seletor de impressora |
| `KioskViews.swift` | Telas: início, seleção, revisão, pagamento Pix, impressão e resultado |
| `AdminView.swift` | Configurações do atendente protegidas por PIN |
| `TouchTracker.swift` | Detecta toques para o tempo de inatividade |
