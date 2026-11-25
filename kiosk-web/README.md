# imprime.ai · estação web (para Chrome e Chromebook)

Versão do quiosque que roda no navegador, sem instalar nada. Serve para um Chromebook, um PC com Windows ou Mac, ou um tablet com Chrome. Faz o mesmo que o **imprime-free** do Android: o cliente escolhe fotos e PDFs, define as cópias e imprime, de graça, com o limite de **20 cópias por dia**.

Esta versão **não** tem Pix, cartão, painel online, envio pelo celular (QR Code) nem 4G/5G. Essas partes ficam no app Android completo e no painel, porque precisam de servidor ou de um token do Mercado Pago que não pode ficar numa página pública.

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
- o PIN (4 a 8 números);
- zerar a contagem de cópias de hoje.

Depois de 5 PINs errados, a janela fica travada por 1 minuto.

## Limites desta versão

- **Limite diário é por navegador.** A contagem fica no `localStorage` deste navegador. Limpar os dados do site ou trocar de navegador zera a contagem. Para um limite que não se apaga, use o app Android ou o imprime.ai pago.
- **PIN guardado no navegador.** Quem tiver acesso ao Chrome desta máquina pode ler o hash, mas o PIN não fica em texto puro.
- **Arquivos.** Fotos e PDFs de até 50 MB. Fotos HEIC (formato do iPhone) não abrem em muitos navegadores e computadores; o app avisa e pede JPG ou PNG.
- **Limite de folhas.** O limite gratuito (20 folhas por dia) também limita o tamanho de cada pedido.

## Arquivos

| Arquivo | O que é |
| --- | --- |
| `index.html` | telas do fluxo (início, arquivos, conferência, confirmação, configurações) |
| `styles.css` | visual, telas de toque e regras de impressão (uma folha por página) |
| `app.js` | lógica: arquivos, páginas, cópias, limite diário, PIN, impressão e inatividade |
| `sw.js` e `manifest.webmanifest` | instalação como app e cache para abrir sem internet |
| `vendor/` | pdf.js 6.2.108 (Apache 2.0, ver `LICENSE-pdfjs.txt`), para contar e desenhar páginas de PDF |
| `tests/e2e.cjs` | teste de ponta a ponta no Chromium (Playwright) |

Quando mudar o app, troque o nome do cache em `sw.js` (`imprime-kiosk-v1` → `v2`) para que os quiosques peguem a versão nova.

## Testes

```sh
NODE_PATH=<pasta global com o playwright> node tests/e2e.cjs <pasta com foto.png e documento.pdf>
```

O teste sobe um servidor local, passa por todo o fluxo (foto e PDF, cópias, limite, PIN, inatividade, layout de celular) e gera um PDF com a impressão para conferir o número de folhas. Os arquivos de teste precisam ter pelo menos uma foto e um PDF de 2 páginas.
