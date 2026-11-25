// Teste de ponta a ponta do vínculo com o painel, do Wi-Fi e do Pix, no Chromium (Playwright).
// O servidor do imprime.ai é simulado com page.route: nada sai para a internet.
// Uso: NODE_PATH=<pasta com playwright> node tests/e2e-cloud.cjs <pasta com fixtures foto.png e documento.pdf>

const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.resolve(process.argv[2] || path.join(__dirname, "fixtures"));
const PORT = 8788;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS_DIR || path.join(FIXTURES, "shots-cloud");
const API = "https://imprime-ai.vercel.app";

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  · " + extra : ""}`);
  if (!ok) failures++;
}

/** Decodifica um QR Code de uma imagem PNG com o OpenCV (se existir). */
function decodeQr(file) {
  const code = `import cv2,sys\nimg=cv2.imread(sys.argv[1])\nt,_,_=cv2.QRCodeDetector().detectAndDecode(img)\nsys.stdout.write(t)`;
  const run = spawnSync("python3", ["-c", code, file], { encoding: "utf8" });
  return run.status === 0 ? run.stdout : null;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // O 402 do passo 8 é proposital (assinatura vencida simulada): o navegador registra a resposta como erro de rede.
  page.on("console", (m) => { if (m.type() === "error" && !/status of (402|404)/.test(m.text())) errors.push(m.text()); });

  // ---------- servidor simulado
  const srv = {
    syncs: [], creates: [], statuses: 0, cancels: [], consumes: [],
    active: false, pixReady: false, validUntil: null, plan: "basic",
    config: null, configVersion: 0,
    paid: false, createError: null, nextId: 100,
    relay: { opens: [], pending: [], deleted: [], closes: 0, expired: false, auth: [] },
  };
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const QR = "00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-426614174000520400005303986540510.005802BR5913LOJA DO TESTE6009SAO PAULO62070503***63041D3D";
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "Content-Type, Authorization", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const body = JSON.parse(request.postData() || "{}");
    if (url.pathname.startsWith("/api/relay/session")) {
      const jsonR = (status, data) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(data) });
      if (url.pathname === "/api/relay/session" && request.method() === "POST") {
        srv.relay.opens.push(body);
        return jsonR(200, { code: "abcd234567", secret: "s".repeat(32), url: `${API}/e/abcd234567`, expiresInSeconds: 1800 });
      }
      srv.relay.auth.push(request.headers()["authorization"]);
      if (srv.relay.expired) return jsonR(404, { error: "Sessão encerrada ou expirada." });
      if (url.pathname.endsWith("/files")) return jsonR(200, { files: srv.relay.pending.map((f) => ({ pathname: f.pathname, name: f.name, size: 1 })), expiresAt: new Date(Date.now() + 1.8e6).toISOString() });
      if (url.pathname.endsWith("/file")) {
        const p = url.searchParams.get("p");
        if (request.method() === "DELETE") { srv.relay.deleted.push(p); srv.relay.pending = srv.relay.pending.filter((f) => f.pathname !== p); return jsonR(200, { ok: true }); }
        return route.fulfill({ status: 200, headers: { ...cors, "content-type": "image/png" }, body: PNG });
      }
      if (request.method() === "DELETE") { srv.relay.closes++; return jsonR(200, { ok: true }); }
    }
    const json = (status, data) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(data) });
    if (url.pathname === "/api/kiosk/sync") {
      srv.syncs.push(body);
      return json(200, {
        accepted: (body.jobs || []).map((j) => j.id),
        activationCode: srv.active ? "PK1-teste" : null, validUntil: srv.active ? srv.validUntil : null,
        plan: srv.plan, active: srv.active, pixReady: srv.pixReady,
        config: srv.configVersion > 0 ? srv.config : null, configVersion: srv.configVersion,
      });
    }
    if (url.pathname === "/api/kiosk/pix") {
      if (body.action === "create") {
        srv.creates.push(body);
        if (srv.createError) return json(402, { error: srv.createError });
        const price = srv.config?.pricePerPageCents ?? 0;
        return json(200, { id: ++srv.nextId, amountCents: price * body.sheets, sheets: body.sheets, qr: QR, expiresAt: new Date(Date.now() + 1.8e6).toISOString() });
      }
      if (body.action === "status") {
        srv.statuses++;
        return json(200, { id: body.id, status: srv.paid ? "approved" : "pending" });
      }
      if (body.action === "cancel") {
        srv.cancels.push(body.id);
        return json(200, { id: body.id, status: srv.paid ? "approved" : "cancelled" });
      }
      if (body.action === "consume") {
        srv.consumes.push(body.id);
        return json(200, { id: body.id, status: "approved", paymentId: "MP" + body.id });
      }
    }
    return json(404, { error: "rota desconhecida" });
  });

  const installPrintStub = () => page.evaluate(() => {
    window.__prints = [];
    window.print = () => {
      window.__prints.push(document.querySelectorAll("#print-area .sheet img").length);
      window.dispatchEvent(new Event("afterprint"));
    };
  });
  const visibleScreen = () => page.evaluate(() => document.querySelector("[data-screen]:not([hidden])")?.dataset.screen);
  const text = (sel) => page.textContent(sel);
  const waitScreen = (name) => page.waitForFunction((n) => document.querySelector("[data-screen]:not([hidden])")?.dataset.screen === n, name, { timeout: 15000 });
  const openSettings = async () => {
    await page.click("#btn-open-settings");
    await page.fill("#pin-input", "1234");
    await page.click("#pin-ok");
    await waitScreen("settings");
  };
  const fillOrder = async () => {
    await page.click("#btn-start");
    await page.setInputFiles("#input-images", path.join(FIXTURES, "foto.png"));
    await page.waitForFunction(() => document.querySelectorAll("#items-list .item").length === 1);
    await page.setInputFiles("#input-pdfs", path.join(FIXTURES, "documento.pdf"));
    await page.waitForFunction(() => document.querySelectorAll("#items-list .item").length === 2);
    await page.click("#btn-to-review");
    await waitScreen("review");
  };
  const home = async () => {
    await page.evaluate(() => document.querySelector("[data-go=welcome]:not([hidden])")?.click());
  };

  // ---------- 1. Wi-Fi da loja
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await installPrintStub();
  check("sem Wi-Fi configurado, o cartão não aparece", !(await page.isVisible("#wifi-card")));
  await openSettings();
  await page.fill("input[name=wifiName]", "Loja do Zé");
  await page.fill("input[name=wifiPassword]", "senha;123");
  await page.click("#settings-form button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#settings-notice").textContent.includes("salvas"));
  await page.click("[data-screen=settings] [data-go=welcome]");
  await waitScreen("welcome");
  check("cartão de Wi-Fi aparece", await page.isVisible("#wifi-card"));
  check("mostra nome da rede", (await text("#wifi-name")) === "Loja do Zé");
  check("mostra a senha", (await text("#wifi-pass")) === "senha;123");
  const wifiPng = path.join(SHOTS, "wifi-qr.png");
  await page.locator("#wifi-qr").screenshot({ path: wifiPng });
  const decoded = decodeQr(wifiPng);
  check("QR de Wi-Fi lê o texto certo", decoded === "WIFI:T:WPA;S:Loja do Zé;P:senha\\;123;;", JSON.stringify(decoded));
  await page.screenshot({ path: path.join(SHOTS, "01-inicio-wifi.png") });

  // ---------- 2. conectar ao painel (ainda sem assinatura): continua gratuito
  await openSettings();
  check("antes de conectar: explica o vínculo", await page.isVisible("#link-off"));
  await page.click("#btn-link-enable");
  await page.waitForFunction(() => document.querySelector("#link-notice").textContent.includes("Conectada"));
  check("fez a primeira sincronização", srv.syncs.length === 1);
  const first = srv.syncs[0];
  check("envia plataforma web", first.platform === "web");
  check("código da loja no formato ABCD-EFGH", /^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(first.storeCode), first.storeCode);
  check("segredo com 64 caracteres", /^[0-9a-f]{64}$/.test(first.secret));
  check("relata o Wi-Fi configurado", first.config.wifiName === "Loja do Zé");
  check("tela mostra o código da loja", (await text("#link-store")) === first.storeCode);
  check("tela mostra o código de vínculo", /^[A-Z2-7]{3}-[A-Z2-7]{3}$/.test(await text("#link-pair")), await text("#link-pair"));
  check("estado: conectada sem assinatura", /sem assinatura ativa/.test(await text("#link-status")));
  await page.screenshot({ path: path.join(SHOTS, "02-vinculo.png"), fullPage: true });
  await page.click("[data-screen=settings] [data-go=welcome]");
  await waitScreen("welcome");

  // ---------- 3. conectada mas sem assinatura: impressão gratuita registra o trabalho
  await fillOrder();
  check("sem assinatura, botão continua 'Imprimir'", (await text("#btn-print")) === "Imprimir");
  check("sem assinatura, terceiro quadro é 'Restam hoje'", (await text("#left-today")) === "20");
  await page.click("#btn-print");
  await waitScreen("check");
  await page.click("#btn-printed");
  await waitScreen("done");
  const used = await page.evaluate(() => JSON.parse(localStorage.getItem("kiosk.free")).used);
  check("gratuito: contou 3 folhas", used === 3, String(used));
  await page.waitForFunction(() => true);
  await page.waitForTimeout(2200);
  const sentJobs = srv.syncs.flatMap((s) => s.jobs);
  check("enviou o trabalho ao painel", sentJobs.length === 1, String(sentJobs.length));
  check("trabalho gratuito sem Pix", sentJobs[0] && sentJobs[0].paidWithPix === false && sentJobs[0].totalPages === 3 && sentJobs[0].amountCents === 0);
  await page.click("#btn-new");
  await waitScreen("welcome");

  // ---------- 4. assinatura ativa + token + preço no painel
  srv.active = true; srv.pixReady = true; srv.validUntil = "2099-12-31";
  srv.config = { kioskName: "Papelaria Teste", pricePerPageCents: 50, maxCopies: 5, maxItems: 10, idleTimeoutSeconds: 120, paymentTimeoutSeconds: 120, payerEmail: "dono@teste.com", wifiName: "Loja do Zé", wifiPassword: "senha;123" };
  srv.configVersion = 1;
  await openSettings(); // abrir as configurações já sincroniza
  await page.waitForFunction(() => /Assinatura/.test(document.querySelector("#link-status").textContent));
  const status = await text("#link-status");
  check("status mostra plano e validade", /Assinatura Básico ativa, liberada até 31\/12\/2099/.test(status), status);
  check("status mostra Pix ativo com preço", /Pix ativo, R\$ 0,50 por página/.test(status), status);
  check("botão de zerar contagem some com assinatura", !(await page.isVisible("#btn-reset-quota")));
  check("aplicou o nome do painel", (await page.inputValue("input[name=kioskName]")) === "Papelaria Teste");
  check("aplicou o máximo de cópias do painel", (await page.inputValue("input[name=maxCopies]")) === "5");
  check("relatou a versão da configuração aplicada", srv.syncs.at(-1).configVersion === 0 || srv.syncs.at(-1).configVersion === 1);
  await page.click("[data-screen=settings] [data-go=welcome]");
  await waitScreen("welcome");
  check("início mostra preço por Pix", /R\$ 0,50 por página · pagamento por Pix/.test(await text("#free-note")), await text("#free-note"));
  check("título usa o nome do painel", (await text("#welcome-title")) === "Papelaria Teste");

  // ---------- 5. pagar com Pix e imprimir
  await fillOrder();
  check("botão vira 'Pagar com Pix'", (await text("#btn-print")) === "Pagar com Pix");
  check("terceiro quadro mostra o valor", (await text("#left-today")) === "R$ 1,50", await text("#left-today"));
  check("sem limite diário (3 folhas)", await page.isEnabled("#copies-plus"));
  await page.screenshot({ path: path.join(SHOTS, "03-conferencia-pix.png") });
  await page.click("#btn-print");
  await waitScreen("pay");
  await page.waitForSelector("#pay-box:not([hidden])");
  check("cobrança pediu 3 folhas", srv.creates.length === 1 && srv.creates[0].sheets === 3);
  check("a página não manda preço (o servidor decide)", !("amountCents" in srv.creates[0]) && !("price" in srv.creates[0]));
  check("valor na tela", (await text("#pay-amount")) === "R$ 1,50", await text("#pay-amount"));
  check("mostra o tempo restante", /Tempo restante: \d:\d\d/.test(await text("#pay-timer")), await text("#pay-timer"));
  const pixPng = path.join(SHOTS, "pix-qr.png");
  await page.locator("#pay-qr").screenshot({ path: pixPng });
  const pixDecoded = decodeQr(pixPng);
  check("QR do Pix lê o 'copia e cola'", pixDecoded === QR, JSON.stringify(pixDecoded)?.slice(0, 60));
  await page.screenshot({ path: path.join(SHOTS, "04-pagamento.png") });
  await page.waitForFunction(() => true);
  await page.waitForTimeout(3600);
  check("consultou o status enquanto esperava", srv.statuses >= 1, String(srv.statuses));
  check("ainda na tela de pagamento", (await visibleScreen()) === "pay");
  check("não imprimiu antes de pagar", (await page.evaluate(() => window.__prints.length)) === 1 /* o do passo 3 */);
  srv.paid = true;
  await waitScreen("check");
  check("liberou o Pix uma vez", srv.consumes.length === 1);
  const prints = await page.evaluate(() => window.__prints);
  check("imprimiu 3 folhas depois do pagamento", prints.at(-1) === 3 && prints.length === 2, JSON.stringify(prints));
  await page.click("#btn-printed");
  await waitScreen("done");
  const free = await page.evaluate(() => JSON.parse(localStorage.getItem("kiosk.free")).used);
  check("assinatura não gasta o limite grátis", free === 3, String(free));
  await page.waitForTimeout(2200);
  const jobs = srv.syncs.flatMap((s) => s.jobs);
  const pixJob = jobs.at(-1);
  check("trabalho enviado como Pix pago", pixJob.paidWithPix === true && pixJob.paymentMethod === "pix" && pixJob.paymentId === "MP101" && pixJob.amountCents === 150, JSON.stringify(pixJob));
  await page.click("#btn-new");
  await waitScreen("welcome");

  // ---------- 6. cancelar o pagamento
  srv.paid = false;
  await fillOrder();
  await page.click("#btn-print");
  await page.waitForSelector("#pay-box:not([hidden])");
  await page.click("#btn-pay-cancel");
  await waitScreen("review");
  check("cancelar avisou o servidor", srv.cancels.length === 1 && srv.cancels[0] === 102, JSON.stringify(srv.cancels));
  check("mensagem de cancelamento", /Nenhum valor foi cobrado/.test(await text("#review-notice")));
  check("nada foi impresso ao cancelar", (await page.evaluate(() => window.__prints.length)) === 2);

  // ---------- 7. pagou, a impressora falhou: imprime de novo sem cobrar outra vez
  await page.click("#btn-print");
  await page.waitForSelector("#pay-box:not([hidden])");
  srv.paid = true;
  await waitScreen("check");
  const createsBefore = srv.creates.length;
  await page.click("#btn-not-printed");
  await waitScreen("review");
  check("pago e 'não saiu': botão 'Imprimir (já pago)'", (await text("#btn-print")) === "Imprimir (já pago)", await text("#btn-print"));
  check("cópias travadas depois de pagar", await page.isDisabled("#copies-plus"));
  await page.click("#btn-print");
  await waitScreen("check");
  check("segunda tentativa não gerou outro Pix", srv.creates.length === createsBefore);
  check("segunda tentativa não consumiu o Pix de novo", srv.consumes.length === 2);
  await page.click("#btn-printed");
  await waitScreen("done");
  await page.click("#btn-new");
  await waitScreen("welcome");

  // ---------- 8. erro do servidor ao criar o Pix (assinatura vencida, por exemplo)
  srv.paid = false;
  srv.createError = "A assinatura desta estação não está ativa. Renove no painel para cobrar por Pix.";
  await fillOrder();
  await page.click("#btn-print");
  await waitScreen("review");
  check("mostra o motivo do servidor", /assinatura desta estação não está ativa/.test(await text("#review-notice")), await text("#review-notice"));
  srv.createError = null;

  // ---------- 9. Pix ainda não ativado no painel: não deixa começar
  srv.pixReady = false;
  await page.reload({ waitUntil: "networkidle" });
  await installPrintStub();
  await openSettings();
  await page.click("#btn-link-sync");
  await page.waitForFunction(() => document.querySelector("#link-notice").textContent.includes("Atualizado"));
  check("status pede o token do Mercado Pago", /falta cadastrar o token/.test(await text("#link-status")), await text("#link-status"));
  await page.click("[data-screen=settings] [data-go=welcome]");
  await waitScreen("welcome");
  await page.click("#btn-start");
  check("sem Pix pronto, o início avisa e não começa", (await visibleScreen()) === "welcome" && /Pix ainda não foi ativado/.test(await text("#welcome-notice")));

  // ---------- 10. desconectar volta ao gratuito
  await openSettings();
  await page.click("#btn-link-disable");
  await page.waitForFunction(() => !document.querySelector("#link-off").hidden);
  check("desconectada: volta a explicar o vínculo", await page.isVisible("#btn-link-enable"));
  check("desconectada: botão de zerar volta", await page.isVisible("#btn-reset-quota"));
  await page.click("[data-screen=settings] [data-go=welcome]");
  await waitScreen("welcome");
  check("desconectada: início volta ao limite grátis", /Versão gratuita/.test(await text("#free-note")), await text("#free-note"));

  // ---------- 12. envio pelo celular (QR Code)
  await page.setViewportSize({ width: 1280, height: 900 });
  const opens0 = srv.relay.opens.length;
  await page.click("#btn-start");
  await waitScreen("select");
  await page.waitForFunction(() => !document.querySelector("#phone-card").hidden, null, { timeout: 10000 });
  check("celular: abre sessão com o nome da estação", srv.relay.opens.length === opens0 + 1 && typeof srv.relay.opens[0].kioskName === "string");
  await page.locator("#phone-qr").screenshot({ path: path.join(SHOTS, "06-qr-celular.png") });
  const phoneQr = decodeQr(path.join(SHOTS, "06-qr-celular.png"));
  check("celular: o QR leva à página de envio", phoneQr === null || phoneQr === `${API}/e/abcd234567`, phoneQr ?? "sem OpenCV");
  srv.relay.pending.push({ pathname: "relay/abcd234567/x1y2z3/minha foto.png", name: "minha foto.png" });
  await page.waitForFunction(() => document.querySelectorAll("#items-list .item").length === 1, null, { timeout: 12000 });
  check("celular: arquivo enviado aparece na lista", (await text("#items-list")).includes("minha foto.png"));
  check("celular: arquivo apagado do servidor depois de salvo", srv.relay.deleted.length === 1);
  check("celular: pedidos levam o segredo da sessão", srv.relay.auth.every((a) => a === "Bearer " + "s".repeat(32)));
  await page.screenshot({ path: path.join(SHOTS, "07-selecao-com-qr.png") });
  srv.relay.expired = true;
  await page.waitForFunction(() => !document.querySelector("#phone-renew").hidden, null, { timeout: 12000 });
  check("celular: sessão vencida oferece novo código", /expirou/.test(await text("#phone-status")));
  srv.relay.expired = false;
  await page.click("#phone-renew");
  await page.waitForFunction(() => !document.querySelector("#phone-card").hidden && document.querySelector("#phone-renew").hidden);
  check("celular: novo código abre outra sessão", srv.relay.opens.length === opens0 + 2);
  const closesBefore = srv.relay.closes;
  await page.click("[data-screen=select] [data-go=welcome]");
  await waitScreen("welcome");
  await page.waitForTimeout(300);
  check("celular: voltar ao início encerra a sessão", srv.relay.closes > closesBefore && (await page.isHidden("#phone-card")));

  // ---------- 11. celular
  await page.setViewportSize({ width: 390, height: 780 });
  await page.screenshot({ path: path.join(SHOTS, "05-celular-inicio.png") });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("celular: sem rolagem horizontal no início com Wi-Fi", overflow <= 0, `overflow=${overflow}px`);

  check("sem erros de JavaScript", errors.length === 0, errors.join(" | ").slice(0, 300));

  await browser.close();
  server.kill();
  console.log(failures === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${failures} TESTE(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
