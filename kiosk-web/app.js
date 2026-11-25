// imprime.ai · estação web (versão gratuita, como o imprime-free do Android).
// Fotos e PDFs do aparelho, cópias, impressão pelo diálogo do navegador e volta ao início por inatividade.

import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;

// ---------------------------------------------------------------- constants

const MAX_FILE_BYTES = 50 * 1024 * 1024;   // mesmo limite do app Android
const FREE_DAILY_COPIES = 20;              // imprime-free: folhas (páginas × cópias) por dia
const IDLE_OPTIONS = [30, 60, 90, 120, 300];
const DEFAULTS = { kioskName: "Estação de Impressão", idleSeconds: 90, maxCopies: 10, maxItems: 20 };
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
};
let nextItemId = 1;

const pagesPerCopy = () => state.items.reduce((sum, item) => sum + item.pages, 0);
const totalSheets = () => pagesPerCopy() * state.copies;

// ---------------------------------------------------------------- screens

function show(name) {
  state.screen = name;
  for (const section of $$("[data-screen]")) section.hidden = section.dataset.screen !== name;
  window.scrollTo(0, 0);
  touch();
  const heading = document.querySelector(`[data-screen="${name}"] h1, [data-screen="${name}"] h2`);
  heading?.setAttribute("tabindex", "-1");
  heading?.focus({ preventScroll: true });
}

function setNotice(id, message, ok = false) {
  const node = document.getElementById(id);
  node.textContent = message ?? "";
  node.classList.toggle("ok", !!ok);
}

function setBusy(on, text = "Preparando a impressão…") {
  state.busy = on;
  $("#busy-text").textContent = text;
  $("#busy").hidden = !on;
}

function renderWelcome() {
  for (const node of $$("[data-station]")) node.textContent = settings.kioskName;
  document.title = `${settings.kioskName} · imprime.ai`;
  $("#free-note").textContent = `Versão gratuita · restam ${copiesLeft()} de ${FREE_DAILY_COPIES} cópias hoje`;
  $("#pin-warning").hidden = pinRecord() !== null;
}

function resetToWelcome() {
  clearTimeout(state.doneTimer);
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
  if (copiesLeft() === 0) {
    setNotice("welcome-notice",
      `Hoje restam 0 cópias de ${FREE_DAILY_COPIES} permitidas. Volte amanhã! Para imprimir sem limite, conheça o imprime.ai.`);
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
  return next >= 1 && next <= settings.maxCopies && pagesPerCopy() * next <= copiesLeft();
}

function changeCopies(delta) {
  const next = state.copies + delta;
  if (!canAddCopies(next)) return;
  state.copies = next;
  renderReview();
}

function renderReview() {
  const left = copiesLeft();
  $("#review-list").replaceChildren(...state.items.map((item) =>
    el("li", {},
      el("span", { class: "name", text: item.name }),
      el("span", { class: "meta", text: `${item.pages} ${item.pages === 1 ? "pág." : "págs."}` }),
    )));
  $("#copies-value").textContent = String(state.copies);
  $("#pages-per-copy").textContent = String(pagesPerCopy());
  $("#total-sheets").textContent = String(totalSheets());
  $("#left-today").textContent = String(left);
  $("#copies-minus").disabled = state.copies <= 1;
  $("#copies-plus").disabled = !canAddCopies(state.copies + 1);

  const over = totalSheets() > left;
  setNotice("review-notice", over
    ? `Este pedido tem ${totalSheets()} folhas, mas hoje restam ${left} de ${FREE_DAILY_COPIES}. Diminua as cópias ou tire arquivos.`
    : "");
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
  if (sheets === 0 || sheets > copiesLeft()) {
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

$("#btn-print").addEventListener("click", printJob);

$("#btn-printed").addEventListener("click", () => {
  addSheetsToday(state.sheetsToPrint);
  state.sheetsToPrint = 0;
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
  setNotice("review-notice", "Nenhuma cópia foi contada. Tente imprimir de novo.");
});

$("#btn-new").addEventListener("click", resetToWelcome);

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

function openSettings() {
  const form = $("#settings-form");
  form.kioskName.value = settings.kioskName;
  form.idleSeconds.value = String(settings.idleSeconds);
  form.maxCopies.value = String(settings.maxCopies);
  form.maxItems.value = String(settings.maxItems);
  form.newPin.value = "";
  setNotice("settings-notice", "");
  show("settings");
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
  });
  if (!storage.write("kiosk.settings", settings)) {
    return setNotice("settings-notice", "Não foi possível salvar as configurações neste navegador.");
  }
  form.newPin.value = "";
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
  if (state.screen === "welcome" || state.screen === "done" || state.printing || state.busy) return;
  if ($("#pin-dialog").open) return;
  if (Date.now() - state.lastActivity > settings.idleSeconds * 1000) resetToWelcome();
}, 2000);

// ---------------------------------------------------------------- start

renderWelcome();
show("welcome");

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
