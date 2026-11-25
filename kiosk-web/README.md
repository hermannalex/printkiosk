# imprime.ai · estação web (para Chrome e Chromebook)

Versão do quiosque que roda no navegador, sem instalar nada. Serve para um Chromebook, um PC com Windows ou Mac, ou um tablet com Chrome. O cliente escolhe fotos e PDFs, define as cópias e imprime.

Há dois modos:

- **Gratuito** (padrão, como o **imprime-free** do Android): até **20 cópias por dia**, sem pagamento e sem precisar de conta.
- **Conectado ao painel, com assinatura ativa**: sem limite diário e com **cobrança por Pix**, como o app Android pago. Cada estação web é um quiosque do painel, com a própria assinatura (Básico, Pro…), histórico de impressões e configurações (preço por página, cópias, Wi-Fi…) feitas no painel.

Em qualquer modo dá para mostrar o **Wi-Fi da loja** na tela inicial, com QR Code para o cliente conectar o celular.

Esta versão **não** tem envio pelo celular (QR Code de upload), maquininha Point nem 4G/5G. Essas partes ficam no app Android completo, porque precisam de servidor local ou de uma impressora na mesma rede.

## Como rodar

O app usa módulos do JavaScript e um service worker, então precisa ser servido por HTTP. Abrir o `index.html` direto do arquivo não funciona.

**Teste no próprio computador:**

```sh
cd kiosk-web
python3 -m http.server 8080
```

Depois abra `http://localhost:8080` no Chrome.

**Em produção:** publique a pasta `kiosk-web` em qualquer hospedagem estática com HTTPS (Vercel, Hostinger, GitHub Pages). O HTTPS é necessário para trocar o PIN, porque a página usa `crypto.subtle` para proteger o PIN.

**Para instalar como app:** no menu do Chrome, escolha *Instalar imprime.ai*. Ele abre em tela cheia, como um app.

**Modo quiosque** (sem barra de endereço, sem sair da página):

```sh
google-chrome --kiosk --kiosk-printing https://seu-dominio/
```

No Chromebook, abra o endereço e use *Instalar* ou o modo tela cheia. Para deixar a tela sempre no app, use o modo quiosque do ChromeOS pelo console de administração do Google Workspace (se o aparelho for gerenciado).

## Impressão

O app abre a janela de impressão do navegador, com uma folha A4 por página (fotos centralizadas, PDFs página a página). Cada cópia repete o pedido inteiro.

- O navegador **não informa** se a folha saiu. Por isso, depois da janela de impressão, o app pergunta **“A impressão saiu?”**. Só conta as cópias do dia quando a resposta é *Sim*. Se a pessoa cancelou a janela, ela toca em *Não saiu* e nada é contado.
- No diálogo de impressão do Chrome, **desmarque “Cabeçalhos e rodapés”** (data, endereço e número da página), senão eles saem na folha.
- No Chromebook, a impressora precisa estar cadastrada no ChromeOS (impressoras de rede compatíveis com o ChromeOS funcionam).

## Configurações (PIN)

Toque em **Configurações** no canto de baixo. O PIN padrão é **1234**: troque na primeira vez. Dá para mudar:

- nome da estação;
- tempo sem uso até voltar ao início (30 s, 1 min, 1 min 30 s, 2 min ou 5 min);
- cópias máximas por pedido (1 a 50) e arquivos máximos por pedido (1 a 50);
- **Wi-Fi da loja**: nome da rede e senha (senha vazia = rede aberta). A tela inicial mostra o QR Code no formato padrão `WIFI:T:WPA;S:…;P:…;;`, que a câmera do celular reconhece;
- o PIN (4 a 8 números);
- zerar a contagem de cópias de hoje (só no modo gratuito).

Depois de 5 PINs errados, a janela fica travada por 1 minuto.

## Painel, assinatura e Pix

Em **Configurações › Painel e assinatura (Pix)**:

1. Toque em **Conectar ao painel**. A estação cria um código da loja (`ABCD-EFGH`) e um segredo que só fica neste navegador, e mostra o **código de vínculo** (`ABC-DEF`).
2. No painel (imprime-ai.vercel.app), o dono entra com o login dele (e-mail, senha e verificação em duas etapas), abre **Quiosques › Adicionar quiosque** e digita os dois códigos. A senha do painel **nunca** é digitada na estação.
3. Na página da estação no painel: assinar um plano, cadastrar o **Access Token do Mercado Pago** em **Pix da estação web** e definir o **preço por página** em Configurações do quiosque.
4. De volta à estação, toque em **Atualizar agora** (ela também atualiza sozinha ao abrir e a cada 30 minutos).

Como o Pix funciona: o navegador **não pode** falar com o Mercado Pago (o servidor deles bloqueia páginas de outros sites, e um token numa página pública seria de qualquer um). Então a estação só diz ao servidor do imprime.ai **quantas folhas** quer imprimir. O servidor calcula o valor com o preço salvo no painel, cria o Pix com o token do dono (guardado criptografado, AES-256-GCM), confere o pagamento direto no Mercado Pago (valor e referência) e só então libera a impressão. Cada pagamento libera **uma** impressão.

- Sem assinatura ativa, a estação continua gratuita (20 cópias por dia, sem Pix), mesmo conectada.
- Com preço 0 no painel, a impressão é livre e sem limite.
- Se o Pix foi pago e a folha não saiu, “Não saiu” volta para a conferência e permite imprimir de novo **sem cobrar outra vez**. Se a tela voltar ao início por inatividade antes disso, o pagamento fica no painel como Pix aprovado, sem impressão registrada.
- O que o servidor cobra vem do número de folhas que a página informa. Um navegador adulterado poderia informar menos folhas do que imprime. É o mesmo nível de confiança do app Android, que também conta no aparelho. Deixe a estação em modo quiosque do Chrome, sem acesso às ferramentas do desenvolvedor.
- Cada impressão concluída é enviada ao painel (histórico, faturamento).

## Limites desta versão

- **Limite diário é por navegador.** No modo gratuito, a contagem fica no `localStorage` deste navegador. Limpar os dados do site ou trocar de navegador zera a contagem. Para um limite que não se apaga, use o app Android ou o imprime.ai pago.
- **PIN guardado no navegador.** Quem tiver acesso ao Chrome desta máquina pode ler o hash, mas o PIN não fica em texto puro.
- **Arquivos.** Fotos e PDFs de até 50 MB. Fotos HEIC (formato do iPhone) não abrem em muitos navegadores e computadores; o app avisa e pede JPG ou PNG.
- **Limite de folhas.** O limite gratuito (20 folhas por dia) também limita o tamanho de cada pedido.

## Arquivos

| Arquivo | O que é |
| --- | --- |
| `index.html` | telas do fluxo (início, arquivos, conferência, confirmação, configurações) |
| `styles.css` | visual, telas de toque e regras de impressão (uma folha por página) |
| `app.js` | lógica: arquivos, páginas, cópias, limite diário, PIN, Wi-Fi, pagamento Pix, impressão e inatividade |
| `cloud.js` | conversa com o painel: vínculo (códigos), sincronização, Pix |
| `sw.js` e `manifest.webmanifest` | instalação como app e cache para abrir sem internet |
| `vendor/` | pdf.js 6.2.108 (Apache 2.0, `LICENSE-pdfjs.txt`) para contar e desenhar páginas de PDF; `qr.mjs`, gerador de QR Code (MIT, Kazuhiko Arase, via qrcode-terminal, `LICENSE-qrcode-terminal.txt`) |
| `tests/e2e.cjs` | teste de ponta a ponta no Chromium (Playwright): fluxo gratuito |
| `tests/e2e-cloud.cjs` | idem para Wi-Fi, vínculo, assinatura e Pix (servidor simulado) |

Quando mudar o app, troque o nome do cache em `sw.js` (`imprime-kiosk-v2` → `v3`) para que os quiosques peguem a versão nova.

## Testes

```sh
NODE_PATH=<pasta global com o playwright> node tests/e2e.cjs <pasta com foto.png e documento.pdf>
NODE_PATH=<pasta global com o playwright> node tests/e2e-cloud.cjs <mesma pasta>
```

Os testes sobem um servidor local e passam por todo o fluxo (foto e PDF, cópias, limite, PIN, inatividade, layout de celular; no segundo, Wi-Fi com QR lido por decodificador, vínculo, assinatura, Pix pago, cancelado e reimpressão sem nova cobrança, tudo contra um servidor simulado) e gera um PDF com a impressão para conferir o número de folhas. Os arquivos de teste precisam ter pelo menos uma foto e um PDF de 2 páginas.
