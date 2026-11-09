# Quioco para Windows e Mac

O mesmo programa para os dois sistemas, sem instalação:

- **Windows 10/11:** `Quioco.exe`. Usa o Microsoft Edge (já vem no Windows) ou o Google Chrome.
- **Mac (macOS 11 ou mais novo, chip Apple ou Intel):** `Quioco.app`. Precisa do **Google Chrome** ou do
  **Microsoft Edge** instalado (o Safari não deixa imprimir sem a janela de impressão).

## Como funciona

- Abre a tela do quiosque no navegador em **modo quiosque** (tela cheia, sem barra de endereço).
  Se alguém fechar a janela, ela abre de novo sozinha.
- O cliente envia fotos e PDFs **do celular**, lendo o QR Code (o celular precisa estar na mesma rede da loja).
- A impressão vai **direto para a impressora**, sem janela de impressão, em folha A4.
- O cliente paga com **Pix** (QR Code), **cartão ou aproximação** (crédito, débito, Apple Pay, Google Pay) numa
  maquininha **Point** do Mercado Pago, ou com um **voucher** de crédito criado no painel (Painel › Vouchers).
- Assinatura, painel online (quioco.vercel.app) e configurações pelo painel: iguais aos apps de iPad/iPhone e Android.
- O token do Mercado Pago fica criptografado: com a conta do Windows (DPAPI) ou com uma chave nas Chaves do Mac.
- Dados em `%LOCALAPPDATA%\Quioco` (Windows) ou `~/Library/Application Support/Quioco` (Mac): configurações,
  assinatura, fila de envio ao painel e o registro `quioco.log`. Os arquivos dos clientes são apagados ao fim de
  cada atendimento e ao abrir o programa.

## Instalar no Windows

1. Copie o `Quioco.exe` para uma pasta fixa, por exemplo `C:\Quioco\`.
2. Instale a impressora no Windows e imprima uma página de teste do Windows.
3. Abra o `Quioco.exe`. Na primeira vez o Windows pode perguntar sobre o **Firewall**: marque **Redes privadas**
   e clique em **Permitir** (é o que deixa os celulares enviarem arquivos). Se o SmartScreen avisar
   "Editor desconhecido", clique em **Mais informações › Executar assim mesmo**.

## Instalar no Mac

1. Instale o Google Chrome (ou o Microsoft Edge).
2. Abra o `Quioco-mac.zip` e arraste o **Quioco.app** para a pasta **Aplicativos**.
3. Na primeira vez, clique no Quioco com o **botão direito › Abrir › Abrir** (o app não é da App Store).
   Se o macOS ainda bloquear: Ajustes do Sistema › Privacidade e Segurança › **Abrir Mesmo Assim**.
4. Se o Firewall do Mac estiver ligado, permita **conexões de entrada** para o Quioco.
5. Instale a impressora em Ajustes do Sistema › Impressoras e Scanners.

## Depois de abrir (os dois sistemas)

1. Toque em **Configurações** (canto superior direito), crie o PIN do atendente e preencha:
   impressora, preço por página, e-mail do pagador e Access Token do Mercado Pago.
   Com uma maquininha Point (Point Smart ou Point Pro 2) da mesma conta, toque em **Buscar maquininhas**
   e escolha a que fica ao lado do quiosque: ela passa para o modo de integração (PDV) sozinha.
2. Marque **Abrir o Quioco ao ligar o computador**.
3. Cadastre o quiosque no painel online com o **código da loja** e o **código de vínculo** mostrados em Configurações.

Para sair: Configurações › **Fechar o Quioco**.

## Dicas para um quiosque de uso público

- Use uma conta de usuário só para o quiosque, sem permissão de administrador, com login automático.
- Desative suspensão e protetor de tela.

## Compilar

Precisa só do Go 1.24 (sem dependências) e, para o Mac, do Python 3:

```
cd desktop
go test ./...
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H windowsgui -s -w" -o dist/Quioco.exe .
tools/build-mac.sh dist        # gera dist/Quioco.app (chip Apple + Intel)
```

Cada push também gera os dois apps nos artefatos da ação **desktop** do GitHub.

Inclui o pdf.js (Mozilla, licença Apache 2.0) em `ui/pdfjs/`.
