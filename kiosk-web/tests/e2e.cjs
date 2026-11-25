// Teste de ponta a ponta no Chromium (Playwright).
// Uso: NODE_PATH=<pasta com playwright> node tests/e2e.cjs <pasta com fixtures foto.png e documento.pdf>
// Sobe um servidor estático na porta 8787 servindo esta pasta (kiosk-web).

const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.resolve(process.argv[2] || path.join(__dirname, "fixtures"));
const PORT = 8787;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS_DIR || path.join(FIXTURES, "shots");

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  · " + extra : ""}`);
  if (!ok) failures++;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: false });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // O envio pelo celular tenta abrir sessão no servidor; sem internet (como neste teste) a falha de rede é esperada e silenciosa.
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_(TUNNEL|INTERNET|NAME|CONNECTION)/.test(m.text())) errors.push(m.text()); });

  // window.print() bloqueia em modo manual; aqui conta as folhas e dispara 'afterprint' como se o diálogo fechasse.
  const installPrintStub = () => page.evaluate(() => {
    window.__sheetsPrinted = null;
    window.print = () => {
      window.__sheetsPrinted = document.querySelectorAll("#print-area .sheet img").length;
      window.dispatchEvent(new Event("afterprint"));
    };
  });

  const visibleScreen = () => page.evaluate(() => document.querySelector("[data-screen]:not([hidden])")?.dataset.screen);

  // ---------- 1. início, pela primeira vez (PIN padrão)
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await installPrintStub();
  check("tela inicial mostra o botão", (await visibleScreen()) === "welcome");
  check("aviso de PIN padrão visível", await page.isVisible("#pin-warning"));
  check("cópias de hoje: 20 de 20", /restam 20 de 20/.test(await page.textContent("#free-note")));
  await page.screenshot({ path: path.join(SHOTS, "01-inicio.png") });

  // ---------- 2. escolher uma foto e um PDF de 2 páginas
  await page.click("#btn-start");
  check("entra na escolha de arquivos", (await visibleScreen()) === "select");
  check("continuar começa desabilitado", await page.isDisabled("#btn-to-review"));
  await page.setInputFiles("#input-images", path.join(FIXTURES, "foto.png"));
  await page.waitForFunction(() => document.querySelectorAll("#items-list .item").length === 1);
  await page.setInputFiles("#input-pdfs", path.join(FIXTURES, "documento.pdf"));
  await page.waitForFunction(() => document.querySelectorAll("#items-list .item").length === 2);
  const metas = await page.$$eval("#items-list .item-meta", (els) => els.map((e) => e.textContent));
  check("foto conta 1 página", metas[0] === "1 página · Foto", metas[0]);
  check("PDF conta 2 páginas", metas[1] === "2 páginas · PDF", metas[1]);
  check("contador de arquivos", (await page.textContent("#items-count")) === "2 de 20 arquivos");
  await page.screenshot({ path: path.join(SHOTS, "02-arquivos.png") });

  // ---------- 3. conferir e aumentar cópias
  await page.click("#btn-to-review");
  check("tela de conferência", (await visibleScreen()) === "review");
  check("3 páginas por cópia", (await page.textContent("#pages-per-copy")) === "3");
  check("1 cópia = 3 folhas", (await page.textContent("#total-sheets")) === "3");
  check("menos desabilitado com 1 cópia", await page.isDisabled("#copies-minus"));
  await page.click("#copies-plus");
  check("2 cópias = 6 folhas", (await page.textContent("#total-sheets")) === "6" && (await page.textContent("#copies-value")) === "2");
  await page.screenshot({ path: path.join(SHOTS, "03-conferencia.png") });

  // ---------- 4. imprimir: 6 folhas, uma por página
  await page.click("#btn-print");
  await page.waitForFunction(() => window.__sheetsPrinted !== null, null, { timeout: 60000 });
  check("gerou 6 folhas para impressão", (await page.evaluate(() => window.__sheetsPrinted)) === 6);
  check("depois da impressão pede confirmação", (await visibleScreen()) === "check");
  check("ainda não contou as cópias", (await page.evaluate(() => localStorage.getItem("kiosk.free"))) === null);

  // "Não saiu": nada contado, volta para a conferência
  await page.click("#btn-not-printed");
  check("'Não saiu' volta para a conferência", (await visibleScreen()) === "review");
  await page.click("#btn-print");
  await page.waitForFunction(() => document.querySelector('[data-screen="check"]:not([hidden])'));
  await page.click("#btn-printed");
  check("'Sim, saiu' vai para a tela final", (await visibleScreen()) === "done");
  const used = await page.evaluate(() => JSON.parse(localStorage.getItem("kiosk.free")).used);
  check("contou 6 folhas no dia", used === 6, `used=${used}`);

  // Saída de PDF da própria página impressa: o layout de impressão tem uma folha por página?
  await page.click("#btn-new");
  check("'Nova impressão' volta ao início", (await visibleScreen()) === "welcome");
  check("restam 14 de 20 depois de imprimir 6", /restam 14 de 20/.test(await page.textContent("#free-note")));

  // ---------- 5. limite diário
  await page.click("#btn-start");
  await page.setInputFiles("#input-pdfs", path.join(FIXTURES, "documento.pdf"));
  await page.waitForFunction(() => document.querySelectorAll("#items-list .item").length === 1);
  await page.click("#btn-to-review");
  // Com 14 folhas restantes e um PDF de 2 páginas, o máximo é 7 cópias (14 folhas).
  for (let i = 0; i < 12; i++) await page.evaluate(() => document.getElementById("copies-plus").click());
  check("cópias param em 7 (14 folhas = tudo que resta)", (await page.textContent("#copies-value")) === "7", await page.textContent("#copies-value"));
  check("total de folhas = 14", (await page.textContent("#total-sheets")) === "14");
  check("'+' desabilitado no limite", await page.isDisabled("#copies-plus"));
  check("imprimir liberado com exatamente 14 folhas", !(await page.isDisabled("#btn-print")));

  // Com 1 folha restante, o pedido de 2 folhas não pode ser impresso.
  await page.reload({ waitUntil: "networkidle" });
  await installPrintStub();
  await page.evaluate(() => localStorage.setItem("kiosk.free", JSON.stringify({ day: new Date().toLocaleDateString("sv-SE"), used: 19 })));
  await page.reload({ waitUntil: "networkidle" });
  await installPrintStub();
  check("com 1 folha restante, início avisa", /restam 1 de 20/.test(await page.textContent("#free-note")));
  await page.click("#btn-start");
  check("com 1 folha restante, ainda deixa escolher arquivos", (await visibleScreen()) === "select");
  await page.setInputFiles("#input-pdfs", path.join(FIXTURES, "documento.pdf"));
  await page.waitForFunction(() => document.querySelectorAll("#items-list .item").length === 1);
  await page.click("#btn-to-review");
  check("aviso de limite na conferência", /hoje restam 1 de 20/.test(await page.textContent("#review-notice")), await page.textContent("#review-notice"));
  check("imprimir bloqueado acima do limite", await page.isDisabled("#btn-print"));
  await page.screenshot({ path: path.join(SHOTS, "04-limite.png") });

  // Com o dia esgotado, o início não deixa começar.
  await page.reload({ waitUntil: "networkidle" });
  await installPrintStub();
  await page.evaluate(() => localStorage.setItem("kiosk.free", JSON.stringify({ day: new Date().toLocaleDateString("sv-SE"), used: 20 })));
  await page.reload({ waitUntil: "networkidle" });
  await page.click("#btn-start");
  check("0 folhas restantes: não começa", (await visibleScreen()) === "welcome");
  check("0 folhas restantes: mensagem no início", /Hoje restam 0 cópias/.test(await page.textContent("#welcome-notice")));

  // Zerar o dia pelo painel: PIN errado primeiro
  await page.evaluate(() => localStorage.removeItem("kiosk.free"));
  await page.reload({ waitUntil: "networkidle" });
  await installPrintStub();

  // ---------- 6. configurações com PIN
  await page.click("#btn-open-settings");
  await page.fill("#pin-input", "0000");
  await page.click("#pin-ok");
  check("PIN errado é recusado", (await page.textContent("#pin-notice")) === "PIN incorreto.");
  await page.fill("#pin-input", "1234");
  await page.click("#pin-ok");
  await page.waitForFunction(() => document.querySelector('[data-screen="settings"]:not([hidden])'));
  check("PIN certo abre as configurações", (await visibleScreen()) === "settings");
  await page.fill("#settings-form [name=kioskName]", "Chromebook Balcão");
  await page.selectOption("#settings-form [name=idleSeconds]", "30");
  await page.fill("#settings-form [name=newPin]", "5678");
  await page.click("#settings-form button[type=submit]");
  check("configurações salvas", (await page.textContent("#settings-notice")) === "Configurações salvas.");
  await page.click("[data-screen='settings'] [data-go='welcome']");
  check("nome da estação atualizado", (await page.textContent("[data-station]")) === "Chromebook Balcão");
  check("aviso de PIN padrão some", await page.isHidden("#pin-warning"));
  await page.click("#btn-open-settings");
  await page.fill("#pin-input", "1234");
  await page.click("#pin-ok");
  check("PIN antigo não serve mais", (await page.textContent("#pin-notice")) === "PIN incorreto.");
  await page.click("#pin-cancel");
  await page.click("#btn-open-settings");
  await page.fill("#pin-input", "5678");
  await page.click("#pin-ok");
  check("PIN novo funciona", (await visibleScreen()) === "settings");
  await page.click("[data-screen='settings'] [data-go='welcome']");

  // ---------- 7. volta ao início sozinho por inatividade (30 s)
  await page.click("#btn-start");
  await page.click("#btn-to-review").catch(() => {});
  await page.waitForTimeout(100);
  await page.evaluate(() => { document.querySelectorAll("#app").length; });
  // Simula 31 s sem toques, ajustando o relógio que o app usa.
  await page.evaluate(() => {
    const real = Date.now;
    const offset = 31_000;
    Date.now = () => real() + offset;
  });
  await page.waitForFunction(() => document.querySelector('[data-screen="welcome"]:not([hidden])'), null, { timeout: 10000 })
    .then(() => check("volta ao início após inatividade", true))
    .catch(() => check("volta ao início após inatividade", false));

  // ---------- 8. layout de celular
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p2 = await phone.newPage();
  await p2.goto(BASE, { waitUntil: "networkidle" });
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("celular: sem rolagem horizontal", overflow <= 0, `overflow=${overflow}px`);
  await p2.screenshot({ path: path.join(SHOTS, "05-celular.png") });
  await p2.click("#btn-start");
  await p2.setInputFiles("#input-images", path.join(FIXTURES, "foto.png"));
  await p2.waitForFunction(() => document.querySelectorAll("#items-list .item").length === 1);
  const overflow2 = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("celular com foto: sem rolagem horizontal", overflow2 <= 0, `overflow=${overflow2}px`);
  await p2.screenshot({ path: path.join(SHOTS, "06-celular-foto.png") });
  await phone.close();

  // ---------- 9. impressão real do navegador: PDF com uma folha por página
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.click("#btn-start");
  await page.setInputFiles("#input-images", path.join(FIXTURES, "foto.png"));
  await page.setInputFiles("#input-pdfs", path.join(FIXTURES, "documento.pdf"));
  await page.waitForFunction(() => document.querySelectorAll("#items-list .item").length === 2);
  await page.click("#btn-to-review");
  await page.click("#copies-plus");
  await page.evaluate(async () => {
    // Monta a área de impressão sem abrir o diálogo, para medir o layout.
    const realPrint = window.print;
    window.print = () => {};
    document.getElementById("btn-print").click();
    await new Promise((r) => setTimeout(r, 4000));
    window.print = realPrint;
  });
  await page.waitForTimeout(500);
  await page.emulateMedia({ media: "print" });
  const sheetCount = await page.$$eval("#print-area .sheet", (els) => els.length);
  const pdfBuf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(path.join(SHOTS, "impressao.pdf"), pdfBuf);
  const pdfPages = (pdfBuf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  check("áreas de impressão: (1 foto + 2 págs do PDF) × 2 cópias = 6 folhas", sheetCount === 6, `folhas=${sheetCount}`);
  check("PDF de impressão tem 6 páginas", pdfPages === 6, `páginas=${pdfPages}`);

  check("sem erros de JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  server.kill();
  console.log(failures === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${failures} TESTE(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
