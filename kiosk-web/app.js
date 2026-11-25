// imprime.ai · estação web.
// Gratuita (como o imprime-free do Android, 20 cópias por dia) ou, ligada ao painel com assinatura ativa, sem
// limite diário e com cobrança por Pix. Fotos e PDFs do aparelho, cópias, impressão pelo diálogo do navegador
// e volta ao início por inatividade.

import * as pdfjsLib from "./vendor/pdf.min.mjs";
import { qrCanvas } from "./vendor/qr.mjs";
import * as cloud from "./cloud.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;

// ---------------------------------------------------------------- constants

const MAX_FILE_BYTES = 50 * 1024 * 1024;   // mesmo limite do app Android
const FREE_DAILY_COPIES = 20;              // imprime-free: folhas (páginas × cópias) por dia
const IDLE_OPTIONS = [30, 60, 90, 120, 300];
const DEFAULTS = { kioskName: "Estação de Impressão", idleSeconds: 90, maxCopies: 10, maxItems: 20, wifiName: "", wifiPassword: "" };
const SYNC_EVERY_MS = 30 * 60_000;
const PIX_POLL_MS = 3000;
const DEFAULT_PAY_SECONDS = 300;
const DEFAULT_PIN = "1234";
const PDF_RENDER_WIDTH = 1654;             // A4 a 200 dpi
const PREVIEW_WIDTH = 240;
const IMAGE_MAX_SIDE = 2400;
const DONE_SECONDS = 12;
const PIN_MAX_TRIES = 5;
const PIN_LOCK_MS = 60_000;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

/** Small DOM helper: el("p", { class: "x", text: "hi" }, child, ...). */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

// ---------------------------------------------------------------- storage (may be blocked: the app still works)

const storage = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function sanitize(raw) {
  const s = { ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
  return {
    kioskName: String(s.kioskName ?? "").trim().slice(0, 40) || DEFAULTS.kioskName,
    idleSeconds: IDLE_OPTIONS.includes(Number(s.idleSeconds)) ? Number(s.idleSeconds) : DEFAULTS.idleSeconds,
    maxCopies: clampInt(s.maxCopies, 1, 50, DEFAULTS.maxCopies),
    maxItems: clampInt(s.maxItems, 1, 50, DEFAULTS.maxItems),
    wifiName: String(s.wifiName ?? "").trim().slice(0, 32),
    wifiPassword: String(s.wifiPassword ?? "").slice(0, 63),
  };
}

let settings = sanitize(storage.read("kiosk.settings", null));

// ---------------------------------------------------------------- PIN (salted SHA-256; default 1234 until changed)

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hashPin(pin, salt) {
  if (!crypto.subtle) {
    throw new Error("Para trocar o PIN, abra esta página por HTTPS (ou em localhost).");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${pin}`));
  return toHex(new Uint8Array(digest));
}

const pinRecord = () => storage.read("kiosk.pin", null);

async function pinMatches(pin) {
  const record = pinRecord();
  if (!record) return pin === DEFAULT_PIN;
  return (await hashPin(pin, record.salt)) === record.hash;
}

async function saveNewPin(pin) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPin(pin, salt);
  if (!storage.write("kiosk.pin", { salt, hash })) {
    throw new Error("Não foi possível salvar o PIN neste navegador.");
  }
}

// ---------------------------------------------------------------- free copies per day (kept in this browser)

const dayKey = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD, local

function sheetsUsedToday() {
  const q = storage.read("kiosk.free", null);
  return q && q.day === dayKey() && Number.isFinite(q.used) ? q.used : 0;
}

const copiesLeft = () => Math.max(0, FREE_DAILY_COPIES - sheetsUsedToday());

function addSheetsToday(n) {
  storage.write("kiosk.free", { day: dayKey(), used: sheetsUsedToday() + n });
}

function resetSheetsToday() {
  storage.write("kiosk.free", { day: dayKey(), used: 0 });
}

// ---------------------------------------------------------------- link with the dashboard (subscription and Pix)

/** What the server told us last time. Without a link, or without a paid month, this station is the free one. */
function loadLink() {
  const raw = storage.read("kiosk.link", null);
  const l = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: l.enabled === true && typeof l.storeCode === "string" && typeof l.secret === "string",
    storeCode: typeof l.storeCode === "string" ? l.storeCode : "",
    secret: typeof l.secret === "string" ? l.secret : "",
    active: l.active === true,
    plan: typeof l.plan === "string" ? l.plan : "",
    validUntil: typeof l.validUntil === "string" ? l.validUntil : "",
    pixReady: l.pixReady === true,
    price: clampInt(l.price, 0, 5000, 0),            // centavos por página, definido no painel
    paySeconds: clampInt(l.paySeconds, 60, 3600, DEFAULT_PAY_SECONDS),
    payerEmail: typeof l.payerEmail === "string" ? l.payerEmail : "",
    configVersion: clampInt(l.configVersion, 0, 1e9, 0),
    jobs: Array.isArray(l.jobs) ? l.jobs.slice(-200) : [],
    lastSyncAt: Number(l.lastSyncAt) || 0,
  };
}

let link = loadLink();
const saveLink = () => storage.write("kiosk.link", link);

/** Assinatura em dia: sem limite diário e com Pix (se houver preço). */
const subscribed = () => link.enabled && link.active && (!link.validUntil || link.validUntil >= dayKey());
const priceCents = () => (subscribed() ? link.price : 0);
const limitLeft = () => (subscribed() ? Infinity : copiesLeft());

// ---------------------------------------------------------------- state

const state = {
  screen: "welcome",
  items: [],          // { id, kind: "image" | "pdf", name, file, pages, preview }
  copies: 1,
  printing: false,
  sheetsToPrint: 0,
  busy: false,
  lastActivity: Date.now(),
  doneTimer: null,
  pinFails: 0,
  pinLockedUntil: 0,
  pay: null,          // cobrança Pix em andamento: { id, qr, amountCents, sheets }
  paid: null,         // Pix já pago e liberado para este pedido: { id, paymentId, amountCents }
};
let payRun = 0;       // muda a cada pagamento iniciado ou cancelado: laços antigos percebem e param
let nextItemId = 1;

const pagesPerCopy = () => state.items.reduce((sum, item) => sum + item.pages, 0);
const totalSheets = () => pagesPerCopy() * state.copies;

// ---------------------------------------------------------------- screens

function show(name) {
  state.screen = name;
  for (const section of $$("[data-screen]")) section.hidden = section.dataset.screen !== name;
  window.scrollTo(0, 0);
  touch();
  if (name === "select" && !phone.session && !phone.opening) phoneOpen();
  else if (name === "select") phoneSchedule();
  const heading = document.querySelector(`[data-screen="${name}"] h1, [data-screen="${name}"] h2`);
  heading?.setAttribute("tabindex", "-1");
  heading?.focus({ preventScroll: true });
}

/** `ok`: true = verde (feito), "info" = cinza (andamento), false = vermelho (aviso ou erro). */
function setNotice(id, message, ok = false) {
  const node = document.getElementById(id);
  node.textContent = message ?? "";
  node.classList.toggle("ok", ok === true);
  node.classList.toggle("info", ok === "info");
}

function setBusy(on, text = "Preparando a impressão…") {
  state.busy = on;
  $("#busy-text").textContent = text;
  $("#busy").hidden = !on;
}

function renderWelcome() {
  for (const node of $$("[data-station]")) node.textContent = settings.kioskName;
  document.title = `${settings.kioskName} · imprime.ai`;
  $("#free-note").textContent = !subscribed()
    ? `Versão gratuita · restam ${copiesLeft()} de ${FREE_DAILY_COPIES} cópias hoje`
    : priceCents() > 0
      ? `${cloud.brl(priceCents())} por página · pagamento por Pix`
      : "Impressão sem limite";
  $("#pin-warning").hidden = pinRecord() !== null;
  renderWifi();
}

/** QR Code de Wi-Fi na tela inicial, como no app Android. */
function renderWifi() {
  const card = $("#wifi-card");
  const name = settings.wifiName;
  card.hidden = !name;
  if (!name) return;
  $("#wifi-name").textContent = name;
  $("#wifi-pass").textContent = settings.wifiPassword;
  $("#wifi-pass-line").hidden = !settings.wifiPassword;
  const canvas = $("#wifi-qr");
  const drawn = qrCanvas(cloud.wifiQrPayload(name, settings.wifiPassword), 360);
  canvas.hidden = !drawn;
  if (drawn) {
    canvas.width = drawn.width;
    canvas.height = drawn.height;
    canvas.getContext("2d").drawImage(drawn, 0, 0);
  }
}

function resetToWelcome() {
  clearTimeout(state.doneTimer);
  abandonPayment();
  phoneClose();
  state.paid = null;
  for (const item of state.items) if (item.kind === "image") URL.revokeObjectURL(item.preview);
  state.items = [];
  state.copies = 1;
  state.printing = false;
  state.sheetsToPrint = 0;
  $("#print-area").replaceChildren();
  setNotice("select-notice", "");
  setNotice("review-notice", "");
  setNotice("welcome-notice", "");
  renderWelcome();
  show("welcome");
}

function startJob() {
  if (limitLeft() === 0) {
    setNotice("welcome-notice",
      `Hoje restam 0 cópias de ${FREE_DAILY_COPIES} permitidas. Volte amanhã! Para imprimir sem limite, conheça o imprime.ai.`);
    return;
  }
  if (priceCents() > 0 && !link.pixReady) {
    setNotice("welcome-notice", "O pagamento por Pix ainda não foi ativado nesta estação. Chame o atendente.");
    return;
  }
  setNotice("welcome-notice", "");
  show("select");
  renderItems();
}

// ---------------------------------------------------------------- files

function kindOf(file) {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type.startsWith("image/")) return "image";
  return null;
}

async function openPdf(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjsLib.getDocument({ data }).promise;
}

/** In pdf.js 6 the document has no destroy(); the loading task releases it. */
function closePdf(doc) {
  doc.loadingTask?.destroy().catch(() => {});
}

/** Draws one PDF page onto a canvas, `width` pixels wide, on a white background. */
async function renderPage(page, width) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function loadItem(file) {
  const kind = kindOf(file);
  if (!kind) throw new Error(`"${file.name}" não é foto nem PDF.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`"${file.name}" passa de 50 MB.`);

  if (kind === "image") {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file); // também confirma que o navegador consegue abrir a foto
    } catch {
      throw new Error(`Não foi possível abrir "${file.name}". Tente salvar a foto em JPG ou PNG.`);
    }
    bitmap.close();
    return { id: nextItemId++, kind, name: file.name, file, pages: 1, preview: URL.createObjectURL(file) };
  }

  let doc;
  try {
    doc = await openPdf(file);
  } catch (error) {
    const reason = error?.name === "PasswordException" ? "O PDF tem senha." : "O arquivo pode estar danificado.";
    throw new Error(`Não foi possível abrir "${file.name}". ${reason}`);
  }
  try {
    if (doc.numPages < 1) throw new Error(`"${file.name}" não tem páginas.`);
    const first = await doc.getPage(1);
    const preview = (await renderPage(first, PREVIEW_WIDTH)).toDataURL("image/jpeg", 0.85);
    return { id: nextItemId++, kind, name: file.name, file, pages: doc.numPages, preview };
  } finally {
    closePdf(doc);
  }
}

// ---------------------------------------------------------------- envio pelo celular

const PHONE_POLL_MS = 3000;
const phone = { session: null, timer: null, opening: false, run: 0, openedAt: 0, polling: false };

function phoneStatus(message) {
  $("#phone-status").textContent = message ?? "";
}

async function phoneOpen() {
  if (phone.opening || state.screen !== "select") return;
  phone.opening = true;
  const run = ++phone.run;
  $("#phone-renew").hidden = true;
  phoneStatus("Preparando o código…");
  try {
    const session = await cloud.relay.open(settings.kioskName);
    if (run !== phone.run) { cloud.relay.close(session).catch(() => {}); return; }
    phone.session = session;
    phone.openedAt = Date.now();
    const drawn = qrCanvas(session.url, 420, "M");
    const canvas = $("#phone-qr");
    if (!drawn) throw new Error("qr");
    canvas.width = drawn.width;
    canvas.height = drawn.height;
    canvas.getContext("2d").drawImage(drawn, 0, 0);
    $("#phone-card").hidden = false;
    phoneStatus("Aguardando o envio…");
    phoneSchedule();
  } catch {
    // Sem internet ou servidor fora do ar: o envio pelo celular some, o resto da estação segue.
    $("#phone-card").hidden = true;
  } finally {
    phone.opening = false;
  }
}

function phoneSchedule() {
  clearTimeout(phone.timer);
  phone.timer = setTimeout(phonePoll, PHONE_POLL_MS);
}

async function phonePoll() {
  const session = phone.session;
  if (!session || state.screen !== "select") return;
  if (phone.polling) return phoneSchedule();
  phone.polling = true;
  const run = phone.run;
  try {
    const { files } = await cloud.relay.list(session);
    if (run !== phone.run) return;
    if (files.length) await phoneReceive(session, files, run);
    phoneSchedule();
  } catch (error) {
    if (run !== phone.run) return;
    if (error.status === 404) {
      // Sessão expirou (30 minutos): pede para gerar outro código.
      phone.session = null;
      phoneStatus("O código expirou.");
      $("#phone-renew").hidden = false;
      $("#phone-qr").getContext("2d").clearRect(0, 0, 9999, 9999);
    } else {
      phoneSchedule();
    }
  } finally {
    phone.polling = false;
  }
}

async function phoneReceive(session, files, run) {
  const room = settings.maxItems - state.items.length;
  if (room <= 0) {
    phoneStatus(`Limite de ${settings.maxItems} arquivos atingido. Imprima estes primeiro.`);
    return;
  }
  files = files.slice(0, room);
  phoneStatus(files.length === 1 ? "Recebendo 1 arquivo…" : `Recebendo ${files.length} arquivos…`);
  const received = [];
  for (const file of files) {
    try {
      const blob = await cloud.relay.download(session, file);
      received.push(new File([blob], file.name, { type: blob.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "") }));
      await cloud.relay.remove(session, file).catch(() => {});
    } catch {
      // Tenta de novo na próxima rodada.
    }
  }
  if (run !== phone.run || !received.length) return;
  await addFiles(received);
  phoneStatus(received.length === 1 ? "Recebido 1 arquivo do celular." : `Recebidos ${received.length} arquivos do celular.`);
}

/** Fecha a sessão e apaga o que ainda estiver no servidor (volta ao início, fim do atendimento). */
function phoneClose() {
  phone.run++;
  clearTimeout(phone.timer);
  const session = phone.session;
  phone.session = null;
  $("#phone-card").hidden = true;
  if (session) cloud.relay.close(session).catch(() => {});
}

$("#phone-renew").addEventListener("click", () => {
  phoneClose();
  phoneOpen();
});

async function addFiles(fileList) {
  const files = [...fileList]; // copy now: the input is cleared right after this call
  if (!files.length) return;
  const room = settings.maxItems - state.items.length;
  if (room <= 0) {
    setNotice("select-notice", `Você atingiu o limite de ${settings.maxItems} arquivos por impressão.`);
    return;
  }
  const accepted = files.slice(0, room);
  const skipped = files.length - accepted.length;
  const problems = [];

  setBusy(true, "Lendo os arquivos…");
  try {
    for (const file of accepted) {
      try {
        state.items.push(await loadItem(file));
      } catch (error) {
        problems.push(error.message || "Um arquivo não pôde ser carregado.");
      }
    }
  } finally {
    setBusy(false);
  }
  if (skipped > 0) {
    problems.push(`Você atingiu o limite de ${settings.maxItems} arquivos por impressão. ${skipped} ficaram de fora.`);
  }
  setNotice("select-notice", problems.join("\n"));
  renderItems();
}

function renderItems() {
  $("#items-list").replaceChildren(...state.items.map((item) => {
    const pages = `${item.pages} ${item.pages === 1 ? "página" : "páginas"}`;
    return el("li", { class: "item" },
      el("img", { class: "thumb", src: item.preview, alt: "" }),
      el("div", {},
        el("div", { class: "item-name", text: item.name }),
        el("div", { class: "item-meta", text: `${pages} · ${item.kind === "pdf" ? "PDF" : "Foto"}` }),
      ),
      el("button", { class: "btn btn-secondary remove", type: "button", "data-remove": String(item.id), text: "Remover" }),
    );
  }));
  $("#items-empty").hidden = state.items.length > 0;
  $("#items-count").textContent = `${state.items.length} de ${settings.maxItems} arquivos`;
  $("#btn-to-review").disabled = state.items.length === 0;
}

$("#items-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  const index = state.items.findIndex((item) => item.id === Number(button.dataset.remove));
  if (index < 0) return;
  const [item] = state.items.splice(index, 1);
  if (item.kind === "image") URL.revokeObjectURL(item.preview);
  setNotice("select-notice", "");
  renderItems();
});

// ---------------------------------------------------------------- review and copies

function canAddCopies(next) {
  return !state.paid && next >= 1 && next <= settings.maxCopies && pagesPerCopy() * next <= limitLeft();
}

function changeCopies(delta) {
  const next = state.copies + delta;
  if (!canAddCopies(next)) return;
  state.copies = next;
  renderReview();
}

function renderReview() {
  const left = limitLeft();
  const price = priceCents();
  $("#review-list").replaceChildren(...state.items.map((item) =>
    el("li", {},
      el("span", { class: "name", text: item.name }),
      el("span", { class: "meta", text: `${item.pages} ${item.pages === 1 ? "pág." : "págs."}` }),
    )));
  $("#copies-value").textContent = String(state.copies);
  $("#pages-per-copy").textContent = String(pagesPerCopy());
  $("#total-sheets").textContent = String(totalSheets());
  // Terceiro quadro: o que sobra do dia (grátis), o valor a pagar (Pix) ou "sem limite".
  const third = $("#left-today");
  third.parentElement.querySelector("dt").textContent = price > 0 ? "Valor a pagar" : subscribed() ? "Limite" : "Restam hoje";
  third.textContent = price > 0 ? cloud.brl(price * totalSheets()) : subscribed() ? "Sem limite" : String(left);
  $("#copies-minus").disabled = !!state.paid || state.copies <= 1;
  $("#copies-plus").disabled = !canAddCopies(state.copies + 1);

  const over = totalSheets() > left;
  setNotice("review-notice", over
    ? `Este pedido tem ${totalSheets()} folhas, mas hoje restam ${left} de ${FREE_DAILY_COPIES}. Diminua as cópias ou tire arquivos.`
    : state.paid ? "Pagamento confirmado. Toque em Imprimir para tentar de novo, sem pagar outra vez." : "", !!state.paid && !over);
  $("#btn-print").textContent = state.paid ? "Imprimir (já pago)" : price > 0 ? "Pagar com Pix" : "Imprimir";
  $("#btn-print").disabled = over || state.items.length === 0;
}

$("#copies-minus").addEventListener("click", () => changeCopies(-1));
$("#copies-plus").addEventListener("click", () => changeCopies(1));

// ---------------------------------------------------------------- printing

/** One JPEG per sheet of one copy, rendered once per file and reused for every copy. */
async function renderItemForPrint(item) {
  if (item.kind === "image") {
    const bitmap = await createImageBitmap(item.file); // respeita a rotação do EXIF
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return [canvas.toDataURL("image/jpeg", 0.92)];
  }

  const doc = await openPdf(item.file);
  try {
    const urls = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      urls.push((await renderPage(page, PDF_RENDER_WIDTH)).toDataURL("image/jpeg", 0.92));
      page.cleanup();
    }
    return urls;
  } finally {
    closePdf(doc);
  }
}

async function buildSheets() {
  const perItem = new Map();
  for (const item of state.items) perItem.set(item.id, await renderItemForPrint(item));
  const sheets = [];
  for (let copy = 0; copy < state.copies; copy++) {
    for (const item of state.items) sheets.push(...perItem.get(item.id));
  }
  return sheets;
}

async function paintPrintArea(urls) {
  const area = $("#print-area");
  area.replaceChildren(...urls.map((url) => el("figure", { class: "sheet" }, el("img", { src: url, alt: "" }))));
  await Promise.all([...area.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));
}

async function printJob() {
  if (state.printing) return;
  const sheets = totalSheets();
  if (sheets === 0 || sheets > limitLeft()) {
    show("review");
    renderReview();
    return;
  }
  state.printing = true;
  setBusy(true);
  try {
    await paintPrintArea(await buildSheets());
    state.sheetsToPrint = sheets;
    window.print(); // o navegador mostra a janela de impressão; 'afterprint' continua o fluxo
  } catch (error) {
    state.printing = false;
    show("review");
    renderReview();
    setNotice("review-notice", `Não foi possível preparar a impressão. ${error?.message ?? ""}`.trim());
  } finally {
    setBusy(false);
  }
}

window.addEventListener("afterprint", () => {
  if (!state.printing) return;
  state.printing = false;
  $("#print-area").replaceChildren();
  show("check"); // o navegador não diz se a folha saiu; a pessoa confirma
});

$("#btn-print").addEventListener("click", () => {
  if (state.printing) return;
  if (priceCents() > 0 && !state.paid) startPayment();
  else printJob();
});

$("#btn-printed").addEventListener("click", () => {
  const sheets = state.sheetsToPrint;
  if (!subscribed()) addSheetsToday(sheets);
  recordJob(sheets);
  state.sheetsToPrint = 0;
  state.paid = null;
  show("done");
  clearTimeout(state.doneTimer);
  state.doneTimer = setTimeout(() => {
    if (state.screen === "done") resetToWelcome();
  }, DONE_SECONDS * 1000);
});

$("#btn-not-printed").addEventListener("click", () => {
  state.sheetsToPrint = 0;
  show("review");
  renderReview();
  setNotice("review-notice", state.paid
    ? "Seu pagamento está guardado. Toque em Imprimir para tentar de novo, sem pagar outra vez."
    : "Nenhuma cópia foi contada. Tente imprimir de novo.", !!state.paid);
});

$("#btn-new").addEventListener("click", resetToWelcome);

// ---------------------------------------------------------------- payment (Pix, created by the server)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Drops the charge in progress (idle, back to start): the QR Code stops working. */
function abandonPayment() {
  payRun += 1;
  const charge = state.pay;
  state.pay = null;
  if (charge && link.enabled) cloud.pix.cancel(link, charge.id).catch(() => {});
}

function paintPixQr(code) {
  const canvas = $("#pay-qr");
  const drawn = qrCanvas(code, 600, "M");
  canvas.hidden = !drawn;
  if (!drawn) return;
  canvas.width = drawn.width;
  canvas.height = drawn.height;
  canvas.getContext("2d").drawImage(drawn, 0, 0);
}

function backToReview(message, ok = false) {
  show("review");
  renderReview();
  if (message) setNotice("review-notice", message, ok);
}

async function startPayment() {
  const sheets = totalSheets();
  if (sheets === 0 || sheets > limitLeft() || !link.enabled) return;
  const run = ++payRun;
  state.pay = null;
  $("#pay-box").hidden = true;
  $("#pay-amount").textContent = cloud.brl(priceCents() * sheets);
  $("#pay-sheets").textContent = `${sheets} ${sheets === 1 ? "folha" : "folhas"}`;
  $("#pay-timer").textContent = "";
  setNotice("pay-notice", "Gerando o Pix…", "info");
  show("pay");

  let charge;
  try {
    charge = await cloud.pix.create(link, sheets);
  } catch (error) {
    if (run === payRun) backToReview(error.message || "Não foi possível gerar o Pix.");
    return;
  }
  if (run !== payRun) {
    cloud.pix.cancel(link, charge.id).catch(() => {}); // a pessoa desistiu enquanto o Pix era criado
    return;
  }
  state.pay = { id: charge.id, qr: charge.qr, amountCents: charge.amountCents, sheets: charge.sheets };
  $("#pay-amount").textContent = cloud.brl(charge.amountCents);
  paintPixQr(charge.qr);
  $("#pay-box").hidden = false;
  setNotice("pay-notice", "Aguardando o pagamento…", "info");
  await watchPayment(run, state.pay);
}

async function watchPayment(run, charge) {
  const deadline = Date.now() + link.paySeconds * 1000;
  let failures = 0;
  let lastPoll = 0;
  while (run === payRun) {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    $("#pay-timer").textContent = `Tempo restante: ${clock(left)}`;
    if (left === 0) return payNotPaid(run, charge, "O tempo para pagar acabou. Nenhum valor foi cobrado.");
    if (Date.now() - lastPoll >= PIX_POLL_MS) {
      lastPoll = Date.now();
      try {
        const result = await cloud.pix.status(link, charge.id);
        if (run !== payRun) return;
        failures = 0;
        if (result.status === "approved") return payApproved(run, charge);
        if (result.status !== "pending") {
          return payNotPaid(run, charge, "Este Pix expirou ou foi cancelado. Nenhum valor foi cobrado.");
        }
        setNotice("pay-notice", "Aguardando o pagamento…", "info");
      } catch {
        if (run !== payRun) return;
        if (++failures >= 3) setNotice("pay-notice", "Sem conexão com o servidor. Tentando de novo…", "info");
      }
    }
    await sleep(500);
  }
}

/** Time ran out or the charge was cancelled: cancel it for good, unless it was paid just now. */
async function payNotPaid(run, charge, message) {
  let result = null;
  try {
    result = await cloud.pix.cancel(link, charge.id);
  } catch {
    // O Pix também vence sozinho.
  }
  if (run !== payRun) return;
  if (result?.status === "approved") return payApproved(run, charge);
  state.pay = null;
  backToReview(message);
}

async function payApproved(run, charge) {
  setNotice("pay-notice", "Pagamento recebido! Preparando a impressão…", "info");
  state.pay = null;
  let result = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3 && !result; attempt++) {
    try {
      result = await cloud.pix.consume(link, charge.id);
    } catch (error) {
      lastError = error;
      if (error.status) break; // o servidor respondeu e recusou: tentar de novo não adianta
      await sleep(1500);
    }
  }
  if (run !== payRun) return;
  if (!result) {
    backToReview(`Pagamento recebido, mas não foi possível liberar a impressão. Chame o atendente. ${lastError?.message ?? ""}`.trim());
    return;
  }
  state.paid = { id: charge.id, paymentId: result.paymentId, amountCents: charge.amountCents };
  await printJob();
}

$("#btn-pay-cancel").addEventListener("click", async () => {
  const charge = state.pay;
  const run = ++payRun; // para o laço que consulta o pagamento
  state.pay = null;
  if (!charge) return backToReview(); // ainda gerando: startPayment cancela o Pix quando ele chegar
  setNotice("pay-notice", "Cancelando…", "info");
  let result = null;
  try {
    result = await cloud.pix.cancel(link, charge.id);
  } catch {
    // vence sozinho
  }
  if (run !== payRun) return;
  if (result?.status === "approved") return payApproved(run, charge); // pagou no mesmo instante
  backToReview("Pagamento cancelado. Nenhum valor foi cobrado.", true);
});

$("#btn-copy-pix").addEventListener("click", async () => {
  const code = state.pay?.qr;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    setNotice("pay-notice", "Código Pix copiado. Cole no app do seu banco.", true);
  } catch {
    setNotice("pay-notice", "Não foi possível copiar. Use o QR Code.");
  }
});

// ---------------------------------------------------------------- link with the dashboard: sync and settings

const PLAN_NAME = { basic: "Básico", pro: "Pro", enterprise: "Enterprise" };
let syncing = false;
let syncTimer = null;

function reportedConfig() {
  return {
    kioskName: settings.kioskName,
    pricePerPageCents: link.price,
    maxCopies: settings.maxCopies,
    maxItems: settings.maxItems,
    idleTimeoutSeconds: settings.idleSeconds,
    paymentTimeoutSeconds: link.paySeconds,
    payerEmail: link.payerEmail,
    wifiName: settings.wifiName,
    wifiPassword: settings.wifiPassword,
  };
}

/** Settings saved in the dashboard win when their version is newer than the one already applied. */
function applyRemoteConfig(config, version) {
  settings = sanitize({
    ...settings,
    kioskName: config.kioskName ?? settings.kioskName,
    idleSeconds: config.idleTimeoutSeconds ?? settings.idleSeconds,
    maxCopies: config.maxCopies ?? settings.maxCopies,
    maxItems: config.maxItems ?? settings.maxItems,
    wifiName: config.wifiName ?? settings.wifiName,
    wifiPassword: config.wifiPassword ?? settings.wifiPassword,
  });
  storage.write("kiosk.settings", settings);
  link.price = clampInt(config.pricePerPageCents, 0, 5000, link.price);
  link.paySeconds = clampInt(config.paymentTimeoutSeconds, 60, 3600, link.paySeconds);
  link.payerEmail = typeof config.payerEmail === "string" ? config.payerEmail : link.payerEmail;
  link.configVersion = version;
}

async function runSync() {
  if (!link.enabled || syncing) return { ok: false, error: null };
  syncing = true;
  try {
    const result = await cloud.sync(link, {
      licenseState: subscribed() ? "active" : "free",
      config: reportedConfig(),
      jobs: link.jobs.slice(0, 200),
    });
    const accepted = new Set(result.accepted ?? []);
    link.jobs = link.jobs.filter((job) => !accepted.has(job.id));
    link.active = result.active === true;
    link.plan = typeof result.plan === "string" ? result.plan : "";
    link.validUntil = typeof result.validUntil === "string" ? result.validUntil : "";
    link.pixReady = result.pixReady === true;
    if (result.config && Number(result.configVersion) > link.configVersion) {
      applyRemoteConfig(result.config, Number(result.configVersion));
      if (state.screen === "settings") fillSettingsForm(); // o painel mudou as configurações: mostra os valores novos
    }
    link.lastSyncAt = Date.now();
    saveLink();
    if (state.screen === "welcome") renderWelcome();
    if (state.screen === "settings") renderLinkCard();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  } finally {
    syncing = false;
  }
}

function syncSoon() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void runSync(), 1500);
}

/** Registers the print in the queue the dashboard reads (only when the station is linked). */
function recordJob(sheets) {
  if (!link.enabled) return;
  const paid = state.paid;
  link.jobs.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    printedAt: new Date().toISOString(),
    items: state.items.length,
    pages: pagesPerCopy(),
    copies: state.copies,
    totalPages: sheets,
    amountCents: paid ? paid.amountCents : 0,
    paidWithPix: !!paid,
    paymentMethod: paid ? "pix" : undefined,
    paymentId: paid ? paid.paymentId : null,
    success: true,
  });
  link.jobs = link.jobs.slice(-200);
  saveLink();
  syncSoon();
}

function pixSummary() {
  if (!link.pixReady) return "Pix: falta cadastrar o token do Mercado Pago no painel.";
  if (link.price <= 0) return "Pix: falta definir o preço por página no painel.";
  return `Pix ativo, ${cloud.brl(link.price)} por página.`;
}

async function renderLinkCard() {
  const on = link.enabled;
  $("#link-off").hidden = on;
  $("#link-on").hidden = !on;
  $("#btn-reset-quota").hidden = subscribed();
  $("#quota-note").textContent = subscribed()
    ? "Assinatura ativa: sem limite diário de cópias."
    : `Versão gratuita: até ${FREE_DAILY_COPIES} cópias por dia, contadas neste navegador.`;

  let status;
  if (!on) {
    status = "Esta estação não está conectada ao painel: versão gratuita, sem Pix.";
  } else if (subscribed()) {
    const plan = PLAN_NAME[link.plan] ? ` ${PLAN_NAME[link.plan]}` : "";
    const until = link.validUntil ? `, liberada até ${link.validUntil.split("-").reverse().join("/")}` : "";
    status = `Assinatura${plan} ativa${until}. ${pixSummary()}`;
  } else if (link.lastSyncAt) {
    status = "Conectada, mas ainda sem assinatura ativa: continua gratuita (20 cópias por dia, sem Pix). Depois de adicionar esta estação no painel e assinar, toque em Atualizar agora.";
  } else {
    status = "Conectando…";
  }
  $("#link-status").textContent = status;

  if (on) {
    $("#link-store").textContent = link.storeCode;
    try {
      $("#link-pair").textContent = await cloud.pairingCode(link.secret);
    } catch {
      $("#link-pair").textContent = "Abra por HTTPS";
    }
  }
}

$("#btn-link-enable").addEventListener("click", async () => {
  if (!crypto.subtle) return setNotice("link-notice", "Para conectar ao painel, abra esta página por HTTPS.");
  if (!link.storeCode || !link.secret) {
    link.storeCode = cloud.newStoreCode();
    link.secret = cloud.newSecret();
  }
  link.enabled = true;
  link.lastSyncAt = 0;
  if (!saveLink()) {
    link.enabled = false;
    return setNotice("link-notice", "Não foi possível guardar o vínculo neste navegador.");
  }
  await renderLinkCard();
  setNotice("link-notice", "Conectando ao painel…", "info");
  const { ok, error } = await runSync();
  setNotice("link-notice", ok ? "Conectada. Agora adicione esta estação no painel com os dois códigos." : error?.message ?? "Não foi possível conectar.", ok);
  await renderLinkCard();
});

$("#btn-link-sync").addEventListener("click", async () => {
  setNotice("link-notice", "Atualizando…", "info");
  const { ok, error } = await runSync();
  setNotice("link-notice", ok ? "Atualizado." : error?.message ?? "Não foi possível atualizar.", ok);
  await renderLinkCard();
});

$("#btn-link-disable").addEventListener("click", async () => {
  link.enabled = false;
  link.active = false;
  link.pixReady = false;
  saveLink();
  setNotice("link-notice", "Estação desconectada: voltou à versão gratuita.", true);
  await renderLinkCard();
  renderWelcome();
});

setInterval(() => {
  if (link.enabled && Date.now() - link.lastSyncAt >= SYNC_EVERY_MS) void runSync();
}, 60_000);

// ---------------------------------------------------------------- navigation

$("#btn-start").addEventListener("click", startJob);

$("#btn-to-review").addEventListener("click", () => {
  state.copies = Math.min(state.copies, settings.maxCopies);
  show("review");
  renderReview();
});

for (const button of $$("[data-go]")) {
  button.addEventListener("click", () => {
    const target = button.dataset.go;
    if (target === "welcome") resetToWelcome();
    else if (target === "select") {
      show("select");
      renderItems();
    }
  });
}

// Staff settings: behind a PIN, with a short lock after repeated wrong tries (per page load).
$("#btn-open-settings").addEventListener("click", () => {
  $("#pin-input").value = "";
  $("#pin-notice").textContent = "";
  $("#pin-dialog").showModal();
  $("#pin-input").focus();
});

$("#pin-cancel").addEventListener("click", () => $("#pin-dialog").close());

$("#pin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const notice = $("#pin-notice");
  if (Date.now() < state.pinLockedUntil) {
    notice.textContent = "Muitas tentativas. Aguarde um minuto.";
    return;
  }
  const pin = $("#pin-input").value.trim();
  try {
    if (!(await pinMatches(pin))) {
      state.pinFails += 1;
      if (state.pinFails >= PIN_MAX_TRIES) {
        state.pinFails = 0;
        state.pinLockedUntil = Date.now() + PIN_LOCK_MS;
      }
      notice.textContent = "PIN incorreto.";
      $("#pin-input").select();
      return;
    }
  } catch (error) {
    notice.textContent = error.message;
    return;
  }
  state.pinFails = 0;
  $("#pin-dialog").close();
  openSettings();
});

function fillSettingsForm() {
  const form = $("#settings-form");
  form.kioskName.value = settings.kioskName;
  form.idleSeconds.value = String(settings.idleSeconds);
  form.maxCopies.value = String(settings.maxCopies);
  form.maxItems.value = String(settings.maxItems);
  form.wifiName.value = settings.wifiName;
  form.wifiPassword.value = settings.wifiPassword;
}

function openSettings() {
  fillSettingsForm();
  $("#settings-form").newPin.value = "";
  setNotice("settings-notice", "");
  setNotice("link-notice", "");
  show("settings");
  void renderLinkCard();
  if (link.enabled) void runSync();
}

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.kioskName.value.trim();
  const newPin = form.newPin.value.trim();
  if (!name) return setNotice("settings-notice", "Digite o nome da estação.");
  if (newPin && !/^[0-9]{4,8}$/.test(newPin)) return setNotice("settings-notice", "O PIN precisa ter de 4 a 8 números.");
  if (newPin) {
    try {
      await saveNewPin(newPin);
    } catch (error) {
      return setNotice("settings-notice", error.message);
    }
  }
  settings = sanitize({
    kioskName: name,
    idleSeconds: form.idleSeconds.value,
    maxCopies: form.maxCopies.value,
    maxItems: form.maxItems.value,
    wifiName: form.wifiName.value,
    wifiPassword: form.wifiPassword.value,
  });
  if (!storage.write("kiosk.settings", settings)) {
    return setNotice("settings-notice", "Não foi possível salvar as configurações neste navegador.");
  }
  form.newPin.value = "";
  renderWelcome();
  setNotice("settings-notice", "Configurações salvas.", true);
});

$("#btn-reset-quota").addEventListener("click", () => {
  resetSheetsToday();
  setNotice("settings-notice", "Contagem de hoje zerada.", true);
});

// ---------------------------------------------------------------- files: buttons and drag and drop

$("#input-images").addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
});
$("#input-pdfs").addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
});

const dropzone = $("#dropzone");
for (const type of ["dragenter", "dragover"]) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add("over");
  });
}
for (const type of ["dragleave", "drop"]) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove("over");
  });
}
dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
// Soltar um arquivo fora da área não pode abrir o arquivo no lugar da página.
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

// ---------------------------------------------------------------- idle: back to the start screen

function touch() {
  state.lastActivity = Date.now();
}
for (const type of ["pointerdown", "keydown", "input", "change"]) {
  document.addEventListener(type, touch, { capture: true, passive: true });
}

setInterval(() => {
  if (state.screen === "welcome" || state.screen === "done" || state.screen === "pay" || state.printing || state.busy) return;
  if ($("#pin-dialog").open) return;
  if (Date.now() - state.lastActivity > settings.idleSeconds * 1000) resetToWelcome();
}, 2000);

// ---------------------------------------------------------------- start

renderWelcome();
show("welcome");
if (link.enabled) void runSync();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
