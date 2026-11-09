// Quioco for Windows and macOS: the kiosk screen. Talks only to the local Quioco program (127.0.0.1).
import * as pdfjs from "./pdfjs/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = "./pdfjs/pdf.worker.min.mjs";
const FONTS = new URL("./pdfjs/standard_fonts/", location.href).href;
const KEY = document.querySelector('meta[name="quioco-key"]').content;
const $ = (id) => document.getElementById(id);
const money = (cents) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-Quioco-Key": KEY, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { lockAdmin(data.error); throw new Error(data.error || "bloqueado"); }
  return data;
}

// ---------------------------------------------------------------- state

const S = {
  screen: "welcome",
  state: null,          // /api/state
  items: [],            // received files, with pages/thumb once read
  meta: new Map(),      // id -> { pages, thumb, error }
  copies: 1,
  payment: null,        // { id, deadline }
  paidId: null,
  lastTouch: Date.now(),
};

function show(name) {
  S.screen = name;
  for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== `s-${name}`;
  $("open-admin").hidden = name === "admin" || name === "pay" || name === "status";
}

function touch() { S.lastTouch = Date.now(); }
for (const type of ["pointerdown", "keydown"]) addEventListener(type, touch, { capture: true });
addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

async function refreshState() {
  try { S.state = await api("/api/state"); } catch { return; }
  const s = S.state.settings;
  $("kiosk-name").textContent = s.kioskName;
  document.title = s.kioskName;
  $("welcome-price").textContent = s.pricePerPageCents > 0 ? `${money(s.pricePerPageCents)} por página · pagamento com Pix` : "Impressão gratuita";
  const lic = S.state.license;
  const notice = $("welcome-notice");
  if (S.state.blocked) {
    notice.textContent = S.state.blocked; notice.className = "notice bad"; notice.hidden = false;
  } else if (s.pricePerPageCents > 0 && !S.state.pixReady) {
    notice.textContent = "Pagamento Pix não configurado. Atendente: toque em Configurações."; notice.className = "notice"; notice.hidden = false;
  } else if (lic.state === "demo") {
    notice.textContent = `Demonstração: ${lic.remaining} impressão(ões) grátis restante(s).`; notice.className = "notice"; notice.hidden = false;
  } else notice.hidden = true;

  const wifi = await api("/api/wifi-qr").catch(() => ({}));
  $("wifi").hidden = !wifi.svg;
  if (wifi.svg) {
    $("wifi-qr").innerHTML = wifi.svg;
    $("wifi-name").textContent = wifi.name;
    $("wifi-pass").textContent = wifi.password;
    $("wifi-pass-row").hidden = !wifi.password;
  }
}

// ---------------------------------------------------------------- welcome → select

$("start").onclick = async () => {
  await refreshState();
  if (S.state.blocked) return;
  S.copies = 1;
  show("select");
  renderItems();
  const up = await api("/api/upload/open", {});
  if (up.error) {
    $("upload-qr").innerHTML = "";
    $("upload-error").textContent = up.error; $("upload-error").hidden = false;
  } else {
    $("upload-error").hidden = true;
    $("upload-qr").innerHTML = up.svg;
  }
};

for (const b of document.querySelectorAll('[data-action="reset"]')) b.onclick = reset;

async function reset() {
  S.items = []; S.meta.clear(); S.copies = 1; S.payment = null; S.paidId = null;
  $("print-root").innerHTML = "";
  await api("/api/reset", {}).catch(() => {});
  $("upload-qr").innerHTML = '<p class="muted">Preparando…</p>';
  await refreshState();
  show("welcome");
}

async function pollItems() {
  if (S.screen !== "select") return;
  const { items = [] } = await api("/api/items").catch(() => ({}));
  const known = S.items.map((i) => i.id).join();
  if (items.map((i) => i.id).join() !== known) {
    S.items = items;
    renderItems();
    for (const it of items) if (!S.meta.has(it.id)) readItem(it);
  }
}
setInterval(pollItems, 1500);

const fileURL = (it) => `/files/${encodeURIComponent(it.id)}?k=${encodeURIComponent(KEY)}`;

async function loadImage(src) {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  return img;
}

/** Counts pages and makes a thumbnail. */
async function readItem(it) {
  S.meta.set(it.id, { pages: 0 });
  try {
    if (it.kind === "pdf") {
      const task = pdfjs.getDocument({ url: fileURL(it), standardFontDataUrl: FONTS });
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const scale = 300 / Math.max(vp.width, vp.height);
      const canvas = document.createElement("canvas");
      const v = page.getViewport({ scale });
      canvas.width = v.width; canvas.height = v.height;
      await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport: v }).promise;
      S.meta.set(it.id, { pages: doc.numPages, thumb: canvas.toDataURL("image/jpeg", 0.8) });
      await task.destroy();
    } else {
      await loadImage(fileURL(it));
      S.meta.set(it.id, { pages: 1, thumb: fileURL(it) });
    }
  } catch (e) {
    console.error("readItem", it.kind, e);
    S.meta.set(it.id, { pages: 0, error: it.kind === "pdf" ? "PDF não pôde ser aberto" : "Formato de foto não suportado" });
  }
  renderItems();
}

function renderItems() {
  const box = $("items");
  box.innerHTML = "";
  if (!S.items.length) {
    box.innerHTML = '<p class="empty">Nenhum arquivo ainda. Os arquivos enviados aparecem aqui.</p>';
  }
  for (const it of S.items) {
    const m = S.meta.get(it.id) || {};
    const el = document.createElement("div");
    el.className = "item";
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (m.thumb) { const img = document.createElement("img"); img.src = m.thumb; img.alt = ""; thumb.append(img); }
    else thumb.innerHTML = m.error ? '<span class="small muted">⚠</span>' : '<div class="spinner" style="width:36px;height:36px;border-width:5px"></div>';
    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("b");
    name.textContent = it.name;
    const info = document.createElement("span");
    info.className = "muted";
    info.textContent = m.error ? m.error : m.pages ? `${m.pages} página(s)` : "Lendo…";
    meta.append(name, info);
    const remove = document.createElement("button");
    remove.className = "remove"; remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", "Remover");
    remove.onclick = async () => {
      await api("/api/items/remove", { id: it.id });
      S.items = S.items.filter((x) => x.id !== it.id); S.meta.delete(it.id); renderItems();
    };
    el.append(thumb, meta, remove);
    box.append(el);
  }
  const ready = S.items.filter((i) => (S.meta.get(i.id) || {}).pages > 0);
  const busy = S.items.some((i) => { const m = S.meta.get(i.id); return !m || (!m.pages && !m.error); });
  $("items-count").textContent = S.items.length ? `${S.items.length} de ${S.state?.settings.maxItems ?? ""}` : "";
  $("to-review").disabled = !ready.length || busy;
  $("to-review").textContent = busy ? "Lendo arquivos…" : "Continuar";
}

// ---------------------------------------------------------------- review

const printable = () => S.items.filter((i) => (S.meta.get(i.id) || {}).pages > 0);
const pageCount = () => printable().reduce((n, i) => n + S.meta.get(i.id).pages, 0);

function renderReview() {
  const s = S.state.settings;
  const pages = pageCount();
  $("r-items").textContent = printable().length;
  $("r-pages").textContent = pages;
  $("r-copies").textContent = S.copies;
  $("copy-minus").disabled = S.copies <= 1;
  $("copy-plus").disabled = S.copies >= s.maxCopies;
  const total = pages * S.copies;
  $("r-total-pages").textContent = `${total} página(s) no total`;
  const cents = total * s.pricePerPageCents;
  $("r-total").textContent = s.pricePerPageCents > 0 ? money(cents) : "Grátis";
  $("checkout").textContent = s.pricePerPageCents > 0 ? `Pagar ${money(cents)} com Pix` : "Imprimir";
}

$("to-review").onclick = async () => { await api("/api/upload/close", {}); await refreshState(); show("review"); renderReview(); };
$("back-select").onclick = () => $("start").onclick();
$("copy-minus").onclick = () => { if (S.copies > 1) S.copies--; renderReview(); };
$("copy-plus").onclick = () => { if (S.copies < S.state.settings.maxCopies) S.copies++; renderReview(); };

function status(title, text, kind) {
  show("status");
  $("status-title").textContent = title;
  $("status-text").textContent = text || "";
  $("status-spinner").hidden = !!kind;
  $("status-icon").hidden = !kind;
  $("status-icon").className = kind === "bad" ? "status-icon bad" : "status-icon";
  $("status-icon").textContent = kind === "bad" ? "!" : "✓";
  $("status-done").hidden = !kind;
}

$("checkout").onclick = async () => {
  if (S.paidId) return printNow();
  status("Preparando…", "");
  const r = await api("/api/checkout", { pages: pageCount(), copies: S.copies }).catch(() => ({ action: "blocked", message: "Erro inesperado. Tente de novo." }));
  if (r.action === "print") return printNow();
  if (r.action === "pay") return startPayment(r);
  if (r.action === "payError") { show("review"); renderReview(); return alertBox(r.message); }
  status("Não foi possível imprimir", r.message, "bad");
  finishLater();
};

function alertBox(text) {
  const n = document.createElement("p");
  n.className = "notice bad"; n.textContent = text;
  $("s-review").querySelector(".review").append(n);
  setTimeout(() => n.remove(), 8000);
}

// ---------------------------------------------------------------- payment

let payTimer = null;
function startPayment(r) {
  show("pay");
  $("pay-amount").textContent = money(r.amountCents);
  $("pay-qr").innerHTML = r.svg;
  $("pay-message").hidden = true;
  $("pay-retry").hidden = true;
  $("pay-cancel").disabled = false;
  S.payment = { id: r.id, deadline: Date.now() + r.seconds * 1000 };
  clearInterval(payTimer);
  let checking = false;
  payTimer = setInterval(async () => {
    const left = Math.max(0, Math.ceil((S.payment.deadline - Date.now()) / 1000));
    $("pay-timer").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    if (checking || (left % 3 !== 0 && left > 0)) return;
    checking = true;
    const st = await api(`/api/pay/status?id=${S.payment.id}`).catch(() => ({ status: "pending" }));
    checking = false;
    if (S.screen !== "pay") return;
    if (st.status === "approved") return paid();
    if (st.status === "failed") return payEnded("O pagamento foi recusado ou cancelado. Nenhum valor foi cobrado.");
    if (st.status === "expired" || (left === 0 && st.status !== "pending")) return payEnded("O tempo para pagar acabou. Nenhum valor foi cobrado.");
    if (left === 0) {
      const last = await api(`/api/pay/status?id=${S.payment.id}`).catch(() => ({}));
      if (last.status === "approved") return paid();
      return payEnded("O tempo para pagar acabou. Nenhum valor foi cobrado.");
    }
  }, 1000);
}

function payEnded(text) {
  clearInterval(payTimer);
  $("pay-qr").innerHTML = "";
  $("pay-message").textContent = text; $("pay-message").className = "notice bad"; $("pay-message").hidden = false;
  $("pay-retry").hidden = false;
}

function paid() {
  clearInterval(payTimer);
  S.paidId = S.payment.id;
  printNow("Pagamento confirmado");
}

$("pay-retry").onclick = () => $("checkout").onclick();
$("pay-cancel").onclick = async () => {
  clearInterval(payTimer);
  $("pay-cancel").disabled = true;
  if (S.payment) {
    const r = await api(`/api/pay/cancel?id=${S.payment.id}`, {}).catch(() => ({}));
    if (r.status === "approved") return paid(); // paid just before tapping Cancel: print anyway
  }
  S.payment = null;
  show("review"); renderReview();
};

// ---------------------------------------------------------------- printing

/** Draws a page to fit A4 portrait, turning landscape pages, and returns a JPEG data URL. */
function toSheet(source, w, h) {
  const rotate = w > h;
  const canvas = document.createElement("canvas");
  canvas.width = rotate ? h : w; canvas.height = rotate ? w : h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (rotate) { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); }
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.92);
}

async function buildPages() {
  const sheets = [];
  for (const it of printable()) {
    if (it.kind === "pdf") {
      const task = pdfjs.getDocument({ url: fileURL(it), standardFontDataUrl: FONTS });
      const doc = await task.promise;
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(200 / 72, 3300 / Math.max(base.width, base.height)); // ~200 dpi
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
        sheets.push(toSheet(canvas, canvas.width, canvas.height));
        page.cleanup();
      }
      await task.destroy();
    } else {
      const img = await loadImage(fileURL(it));
      const limit = 3300 / Math.max(img.naturalWidth, img.naturalHeight);
      const k = Math.min(1, limit);
      sheets.push(toSheet(img, Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k)));
    }
  }
  return sheets;
}

async function printNow(heading) {
  status(heading || "Preparando a impressão…", "Isso leva alguns segundos.");
  let ok = false;
  const pages = pageCount();
  try {
    const sheets = await buildPages();
    const root = $("print-root");
    root.innerHTML = "";
    for (let c = 0; c < S.copies; c++) {
      for (const src of sheets) {
        const div = document.createElement("div");
        div.className = "sheet";
        const img = document.createElement("img");
        img.src = src;
        div.append(img);
        root.append(div);
      }
    }
    await Promise.all([...root.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));
    status("Imprimindo…", "Aguarde as folhas saírem da impressora.");
    await new Promise((r) => setTimeout(r, 300));
    window.print(); // the browser runs with --kiosk-printing: no dialog, straight to the printer
    ok = true;
  } catch (e) {
    console.error(e);
  }
  $("print-root").innerHTML = "";
  await api("/api/print/done", { success: ok, items: printable().length, pages, copies: S.copies, paymentId: S.paidId || "" }).catch(() => {});
  if (ok) status("Pronto!", "Retire suas folhas na impressora. Obrigado!", "ok");
  else status("Não foi possível imprimir", S.paidId ? "Seu pagamento foi recebido. Chame um atendente para imprimir." : "Tente de novo ou chame um atendente.", "bad");
  S.paidId = ok ? null : S.paidId;
  finishLater();
}

let finishTimer = null;
function finishLater() {
  clearTimeout(finishTimer);
  finishTimer = setTimeout(() => { if (S.screen === "status") reset(); }, 15000);
}

// ---------------------------------------------------------------- idle

setInterval(() => {
  if (!S.state || !["select", "review"].includes(S.screen)) return;
  if (S.screen === "select" && S.items.length === 0 && Date.now() - S.lastTouch < 180000) return;
  if (Date.now() - S.lastTouch > S.state.settings.idleTimeoutSeconds * 1000) reset();
}, 2000);

// ---------------------------------------------------------------- staff settings

let pinBuffer = "";
let pinMode = "enter"; // enter | create | confirm | change | change-confirm
let pinFirst = "";

function renderKeypad() {
  const pad = $("keypad");
  pad.innerHTML = "";
  for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"]) {
    const b = document.createElement("button");
    b.type = "button"; b.className = k === "OK" ? "btn btn-primary" : "btn"; b.textContent = k;
    b.onclick = () => {
      if (k === "⌫") pinBuffer = pinBuffer.slice(0, -1);
      else if (k === "OK") return submitPin();
      else if (pinBuffer.length < 12) pinBuffer += k;
      $("pin-dots").innerHTML = "<span></span>".repeat(pinBuffer.length);
    };
    pad.append(b);
  }
}
renderKeypad();

function pinScreen(mode, help) {
  pinMode = mode; pinBuffer = "";
  $("pin-dots").innerHTML = "";
  $("pin-error").hidden = true;
  $("pin-title").textContent = mode.startsWith("enter") ? "Configurações" : "Criar PIN do atendente";
  $("pin-help").textContent = help;
  $("pin-gate").hidden = false; $("admin-panel").hidden = true;
}

function pinError(text) { $("pin-error").textContent = text; $("pin-error").className = "notice bad"; $("pin-error").hidden = false; pinBuffer = ""; $("pin-dots").innerHTML = ""; }

async function submitPin() {
  if (pinMode === "enter") {
    const r = await api("/api/admin/unlock", { pin: pinBuffer });
    if (r.error) return pinError(r.error);
    return openPanel();
  }
  if (pinMode === "create" || pinMode === "change") {
    pinFirst = pinBuffer;
    return pinScreen(pinMode === "create" ? "confirm" : "change-confirm", "Digite o mesmo PIN de novo para confirmar.");
  }
  const r = await api("/api/admin/pin", { pin: pinFirst, confirm: pinBuffer }).catch((e) => ({ error: e.message }));
  if (r.error) { pinScreen(pinMode === "confirm" ? "create" : "change", "Crie um PIN de 6 a 12 números."); return pinError(r.error); }
  openPanel("PIN salvo.");
}

$("open-admin").onclick = async () => {
  await refreshState();
  if (["select"].includes(S.screen)) await api("/api/upload/close", {});
  show("admin");
  if (S.state.pinSet) pinScreen("enter", "Digite o PIN do atendente.");
  else pinScreen("create", "Crie um PIN de 6 a 12 números. Ele protege o Pix, a impressora e a assinatura.");
};
$("pin-cancel").onclick = reset;
$("admin-close").onclick = async () => { await api("/api/admin/lock", {}); reset(); };
$("a-pin-change").onclick = () => pinScreen("change", "Digite o novo PIN (6 a 12 números).");

function lockAdmin(message) {
  if (S.screen !== "admin") return;
  pinScreen("enter", message || "Digite o PIN do atendente.");
}

function adminMsg(text, bad) {
  const m = $("admin-msg");
  m.textContent = text; m.className = bad ? "notice bad" : "notice ok"; m.hidden = !text;
  if (text) $("admin-panel").scrollIntoView({ block: "start" });
}

async function openPanel(message) {
  const info = await api("/api/admin/info");
  $("pin-gate").hidden = true; $("admin-panel").hidden = false;
  fillPanel(info);
  adminMsg(message || "");
}

function fillPanel(info) {
  const s = info.settings;
  const lic = info.license;
  $("a-license").innerHTML = "";
  const t = { active: `Assinatura ativa até ${new Date(lic.until + "T12:00").toLocaleDateString("pt-BR")}.`,
    expired: `Assinatura vencida em ${new Date(lic.until + "T12:00").toLocaleDateString("pt-BR")}.`,
    demo: `Demonstração: ${lic.remaining} impressão(ões) grátis restante(s).`,
    demoOver: "Demonstração encerrada." }[lic.state];
  $("a-license").textContent = `${t} Planos ${info.priceLabel}. Contato: ${info.vendor}`;
  $("a-store").textContent = info.storeCode;
  $("a-pair").textContent = info.pairingCode;
  $("a-dash").textContent = info.dashboard.replace(/^https?:\/\//, "");
  $("f-price").value = (s.pricePerPageCents / 100).toFixed(2).replace(".", ",");
  $("f-email").value = s.payerEmail;
  $("f-paytime").value = String(s.paymentTimeoutSeconds);
  $("f-name").value = s.kioskName;
  $("f-copies").value = s.maxCopies;
  $("f-items").value = s.maxItems;
  $("f-idle").value = String(s.idleTimeoutSeconds);
  $("f-wifi").value = s.wifiName;
  $("f-wifipass").value = s.wifiPassword;
  $("a-token").textContent = info.tokenSuffix ? `Access Token: salvo (termina em ${info.tokenSuffix})` : "Access Token: não configurado";
  $("a-token-input").value = "";
  const sel = $("a-printer");
  sel.innerHTML = "";
  for (const p of info.printers || []) {
    const o = document.createElement("option");
    o.value = p.Name; o.textContent = p.Name + (p.Offline ? " (desligada)" : "");
    o.selected = p.Default;
    sel.append(o);
  }
  $("a-printer-note").textContent = info.printerError || (info.printers?.length ? `O Quioco imprime direto, sem janela, na impressora escolhida (ela vira a padrão do ${info.platform}).` : `Nenhuma impressora instalada no ${info.platform}. Instale a impressora e reabra esta tela.`);
  $("a-sync").textContent = (info.lastSync ? `Última sincronização: ${info.lastSync}.` : "Ainda não sincronizou.") +
    (info.pending ? ` ${info.pending} impressão(ões) aguardando envio.` : "") + (info.syncError ? ` Erro: ${info.syncError}` : "");
  $("a-autostart").checked = info.autostart;
  $("a-version").textContent = `Quioco para ${info.platform} ${info.version} · dados em ${info.dataDir}`;
  $("a-token-note").textContent = info.platform === "macOS" ? "O token fica criptografado com uma chave guardada nas Chaves (Keychain) deste Mac." : "O token fica criptografado com a conta do Windows deste computador.";
}

function parseMoney(text) {
  const clean = text.replace(/R\$|\s/gi, "");
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean.replace(",", ".")) * 100);
}

$("admin-save").onclick = async () => {
  const cents = parseMoney($("f-price").value);
  if (cents === null || cents > 5000) return adminMsg("Preço por página inválido (de 0,00 a 50,00).", true);
  const r = await api("/api/admin/settings", {
    kioskName: $("f-name").value, pricePerPageCents: cents, payerEmail: $("f-email").value,
    paymentTimeoutSeconds: Number($("f-paytime").value), maxCopies: Number($("f-copies").value),
    maxItems: Number($("f-items").value), idleTimeoutSeconds: Number($("f-idle").value),
    wifiName: $("f-wifi").value, wifiPassword: $("f-wifipass").value,
  });
  if (r.error) return adminMsg(r.error, true);
  await refreshState();
  openPanel("Configurações salvas.");
};
$("a-token-save").onclick = async () => {
  const v = $("a-token-input").value.trim();
  if (!v) return adminMsg("Cole o Access Token primeiro.", true);
  const r = await api("/api/admin/token", { token: v });
  r.error ? adminMsg(r.error, true) : openPanel("Token salvo.");
};
$("a-token-remove").onclick = async () => { await api("/api/admin/token", { token: "" }); openPanel("Token removido."); };
$("a-token-test").onclick = async () => { adminMsg("Testando…"); const r = await api("/api/admin/test-mp", {}); adminMsg(r.error || r.message, !!r.error); };
$("a-activate").onclick = async () => { const r = await api("/api/admin/activate", { code: $("a-code").value }); r.error ? adminMsg(r.error, true) : openPanel(r.message); };
$("a-sync-now").onclick = async () => { adminMsg("Sincronizando…"); const info = await api("/api/admin/sync", {}); fillPanel(info); adminMsg(info.syncError ? `Erro: ${info.syncError}` : "Sincronizado.", !!info.syncError); };
$("a-printer").onchange = async () => { const info = await api("/api/admin/printer", { name: $("a-printer").value }); if (info.error) return adminMsg(info.error, true); fillPanel(info); adminMsg("Impressora escolhida."); };
$("a-autostart").onchange = async () => { const info = await api("/api/admin/autostart", { on: $("a-autostart").checked }); if (info.error) return adminMsg(info.error, true); fillPanel(info); };
$("a-quit").onclick = async () => { await api("/api/admin/quit", {}); document.body.innerHTML = '<p style="padding:40px;font-size:24px">Quioco fechado.</p>'; };
$("a-test-page").onclick = () => {
  const root = $("print-root");
  const name = S.state?.settings.kioskName || "Quioco";
  root.innerHTML = `<div class="sheet" style="flex-direction:column;gap:12mm;font:16pt 'Segoe UI',sans-serif;text-align:center">
    <img src="icon.svg" style="width:40mm;height:40mm"><div style="font-size:28pt;font-weight:700"></div>
    <div>Página de teste do Quioco</div><div>${new Date().toLocaleString("pt-BR")}</div>
    <div style="display:flex;gap:4mm">${["#000", "#00a0e9", "#e4007f", "#fff100"].map((c) => `<span style="width:20mm;height:20mm;background:${c};border:1px solid #000;display:inline-block;-webkit-print-color-adjust:exact;print-color-adjust:exact"></span>`).join("")}</div></div>`;
  root.querySelector(".sheet div").textContent = name;
  setTimeout(() => { window.print(); root.innerHTML = ""; adminMsg("Página de teste enviada para a impressora."); }, 300);
};

// ---------------------------------------------------------------- start

refreshState().then(() => show("welcome"));
setInterval(() => { if (S.screen === "welcome") refreshState(); }, 60000);
