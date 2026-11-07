# PrintKiosk para tablet Android (com Pix)

A versão Android da estação de impressão self-service. O fluxo é o mesmo do app para iPad e iPhone:

1. O cliente toca em **Toque para começar** e escolhe fotos ou PDFs.
2. Ele escolhe quantas cópias quer e vê o valor total.
3. Ele paga com **Pix** lendo o QR Code gerado pelo Mercado Pago.
4. Assim que o pagamento é confirmado, abre a janela de impressão do Android.

Feito em Kotlin com Jetpack Compose. Funciona em Android 8.0 ou mais recente.

## Funcionalidades

- Fotos (seletor de fotos do Android) e PDFs (app Arquivos, Google Drive, pen drive)
- Seletor de cópias com total de páginas e valor em reais
- Pix com QR Code dinâmico do Mercado Pago e confirmação automática (consulta a cada 3 segundos)
- Proteções no pagamento:
  - QR Codes não pagos são cancelados quando o tempo acaba ou quando o cliente toca em Cancelar.
  - Se o cliente pagar e tocar em Cancelar logo em seguida, o app imprime mesmo assim.
  - Se a impressão falhar ou for cancelada depois do pagamento, "Tentar de novo" não cobra outra vez. A tela mostra o código do pagamento para o atendente.
- Preço R$ 0,00 desativa o Pix (impressão gratuita)
- Volta ao início por inatividade (nunca enquanto o QR Code está na tela)
- Botão **Configurações** na tela inicial, protegido por PIN:
  - preço, token do Mercado Pago, limites, tempos, nome do quiosque
  - página de teste
  - fixar o app na tela
- Token guardado criptografado com uma chave do Android Keystore (fica só neste tablet e fora dos backups)
- Tela sempre acesa e botão Voltar desativado no modo quiosque

## Diferenças em relação ao iPad

O Android não deixa um app comum imprimir direto numa impressora salva. Toda impressão passa pela **janela de impressão do Android**, e o cliente toca em **Imprimir** nela. Essa janela lembra a última impressora usada. Por isso:

- Para escolher a impressora da loja, faça uma página de teste (em Configurações › Impressora) e selecione a impressora na janela.
- O app não consegue verificar se a impressora está ligada antes de cobrar. Se o cliente pagar e a impressão falhar, ele pode tentar de novo sem pagar outra vez.

## Compilar no Android Studio

### 1. Instalar o Android Studio

1. Baixe em **developer.android.com/studio** e instale. Funciona no Mac, no Windows ou no Linux.
2. Na primeira abertura, siga o assistente com a instalação **Standard**. Ele baixa o Android SDK.

### 2. Abrir o projeto

1. Descompacte **PrintKioskAndroid.zip**.
2. No Android Studio, escolha **File › Open…** e selecione a pasta **PrintKioskAndroid**.
3. Espere a barra inferior terminar o **Gradle Sync**. Na primeira vez ele baixa as bibliotecas, então leva alguns minutos.
4. Se o Android Studio sugerir atualizar o Android Gradle Plugin ou o Kotlin, pode aceitar.

### 3. Preparar o tablet

1. No tablet, vá em **Configurações › Sobre o tablet** e toque **7 vezes** em **Número da versão** (em alguns modelos fica em **Informações do software**).
2. Volte e abra **Opções do desenvolvedor**. Ative **Depuração USB**.
3. Ligue o tablet ao computador pelo cabo e toque em **Permitir** na pergunta sobre depuração USB.

### 4. Rodar

1. No topo do Android Studio, escolha o seu tablet na lista de dispositivos.
2. Clique em **▶ Run** (ou Shift+F10 no Windows, Ctrl+R no Mac).

### 5. Gerar um APK para instalar sem cabo

1. Escolha **Build › Generate App Bundles or APKs › Generate APKs**.
2. Quando terminar, clique em **locate**. O arquivo fica em `app/build/outputs/apk/debug/app-debug.apk`.
3. Copie o APK para o tablet e toque nele para instalar. O Android pede para permitir a instalação de fontes desconhecidas.

O APK gerado assim é de depuração e serve para uso na loja. Para publicar na Play Store, use **Build › Generate Signed App Bundle or APK**.

## Primeira configuração no tablet

1. Na tela inicial, toque em **Configurações** (logo abaixo da impressora).
2. Digite o PIN padrão **1234** e troque-o em **PIN do atendente**.
3. Em **Impressora**, toque em **Imprimir página de teste** e escolha a impressora da loja na janela. Ela precisa estar no mesmo Wi-Fi.
   - Se a impressora não aparecer, instale o plugin de impressão da marca pela Play Store (HP Print Service, Epson Print Enabler, Canon Print Service etc.), ou use o **Serviço de impressão padrão** do Android.
4. Em **Pagamento Pix**:
   - defina o preço por página e o e-mail da loja;
   - cole o **Access Token de produção** do Mercado Pago e toque em **Salvar token**;
   - toque em **Testar conexão**.
5. Em **Travar o tablet no app**, toque em **Fixar app na tela**.

## Credenciais do Mercado Pago

1. Em **mercadopago.com.br/developers**, entre em **Suas integrações** e crie uma aplicação.
2. Abra **Credenciais**, escolha **Produção** e ative o ambiente de produção.
3. Copie o **Access Token** (começa com `APP_USR-`).
4. Confirme que a conta tem uma **chave Pix cadastrada**.

## Testar antes de abrir ao público

1. Ponha o preço em R$ 0,10.
2. Faça uma impressão e pague com seu celular.
3. Devolva o valor no painel do Mercado Pago (Atividade › o pagamento › Devolver).

## Travar o tablet no app

- **Fixar app** (qualquer tablet):
  1. Ative em **Configurações › Segurança › Fixar app** (o nome varia por marca, por exemplo "Fixação de tela").
  2. Toque em **Fixar app na tela** nas configurações do PrintKiosk.
- **Tablets gerenciados**: use o modo quiosque do seu MDM (por exemplo Android Enterprise "Dispositivo dedicado").

## Arquivos

| Arquivo | Função |
| --- | --- |
| `MainActivity.kt` | Entrada do app; tela acesa, detector de toques, janela de impressão |
| `KioskViewModel.kt` | Estado da sessão, itens, fluxo de pagamento, impressão e reinício |
| `PixService.kt` | API do Mercado Pago: criar cobrança Pix, consultar status, cancelar |
| `PrintService.kt` | Monta as páginas (fotos e PDFs) para a impressão e a página de teste |
| `ItemLoader.kt` | Copia fotos e PDFs escolhidos, lê páginas e miniaturas |
| `Storage.kt` | Configurações, token criptografado, formatação em reais |
| `Screens.kt` | Telas: início, seleção, revisão, Pix, impressão e resultado |
| `AdminScreen.kt` | Configurações do atendente protegidas por PIN |
| `Models.kt`, `Theme.kt` | Tipos de dados e cores |
