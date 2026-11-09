# Quioco para Windows

Um único arquivo, `Quioco.exe`, sem instalação. Funciona em Windows 10 e 11 com o Microsoft Edge
(já vem no Windows) ou o Google Chrome.

## Como funciona

- O `Quioco.exe` abre a tela do quiosque no Edge em **modo quiosque** (tela cheia, sem barra de endereço).
  Se alguém fechar a janela, ela abre de novo sozinha.
- O cliente envia fotos e PDFs **do celular**, lendo o QR Code (o celular precisa estar na mesma rede da loja).
- A impressão vai **direto para a impressora**, sem janela de impressão, em folha A4.
- Pix pelo Mercado Pago, assinatura, painel online (quioco.vercel.app) e configurações pelo painel:
  iguais aos apps de iPad/iPhone e Android.
- O token do Mercado Pago fica criptografado com a conta do Windows (DPAPI).
- Dados em `%LOCALAPPDATA%\Quioco` (configurações, assinatura, fila de envio ao painel e registro `quioco.log`).
  Os arquivos dos clientes são apagados ao fim de cada atendimento e ao abrir o programa.

## Instalar na loja

1. Copie o `Quioco.exe` para uma pasta fixa, por exemplo `C:\Quioco\`.
2. Instale a impressora no Windows (Configurações › Bluetooth e dispositivos › Impressoras) e imprima uma página de teste do Windows.
3. Abra o `Quioco.exe`. Na primeira vez o Windows pode perguntar sobre o **Firewall**: marque **Redes privadas**
   e clique em **Permitir** (é o que deixa os celulares enviarem arquivos). Se o Windows SmartScreen avisar
   "Editor desconhecido", clique em **Mais informações › Executar assim mesmo**.
4. Toque em **Configurações** (canto superior direito), crie o PIN do atendente e preencha:
   impressora, preço por página, e-mail do pagador e Access Token do Mercado Pago.
5. Marque **Abrir o Quioco ao ligar o computador**.
6. Cadastre o quiosque no painel online com o **código da loja** e o **código de vínculo** mostrados em Configurações.

Para sair: Configurações › **Fechar o Quioco**.

## Dicas para um quiosque de uso público

- Crie uma conta de usuário do Windows só para o quiosque, sem senha de administrador, com login automático.
- Desative suspensão e protetor de tela (Configurações › Sistema › Energia).
- Em computador com tela de toque, deixe o Windows em modo tablet/teclado virtual automático.

## Compilar

Precisa só do Go 1.24 (sem dependências):

```
cd windows
go test ./...
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H windowsgui -s -w" -o Quioco.exe .
```

Cada push também gera o `Quioco.exe` nos artefatos da ação **windows** do GitHub.

Inclui o pdf.js (Mozilla, licença Apache 2.0) em `ui/pdfjs/`.
