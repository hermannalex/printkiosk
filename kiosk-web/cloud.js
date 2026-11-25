// imprime.ai · estação web: conversa com o painel (vínculo, assinatura e Pix).
// O navegador não pode falar com o Mercado Pago (o servidor deles bloqueia páginas de outros sites e um
// token numa página pública seria de todo mundo). Por isso o Pix é criado pelo servidor do imprime.ai,
// com o token que o dono cadastrou no painel. Esta página só diz quantas folhas quer imprimir.

export const API_BASE = "https://imprime-ai.vercel.app";
export const PANEL_URL = `${API_BASE}/painel/quiosques`;
export const APP_VERSION = "web-2";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // base32: o mesmo alfabeto dos apps e do painel
const enc = new TextEncoder();
const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** "ABCD-EFGH": identifica esta estação no painel (256 é múltiplo de 32, então não há viés). */
export function newStoreCode() {
  const text = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => ALPHABET[b % 32]).join("");
  return `${text.slice(0, 4)}-${text.slice(4)}`;
}

/** Segredo do aparelho: 64 caracteres. Só o hash dele fica no servidor. */
export function newSecret() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Código de vínculo de 6 caracteres que o dono digita no painel junto com o código da loja.
 * Mesma conta do painel (lib/license.ts) e dos apps: base32(sha256("pair:" + sha256hex(secret))), 6 primeiros.
 */
export async function pairingCode(secret) {
  const sha = async (text) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  const digest = await sha(`pair:${toHex(await sha(secret))}`);
  let bits = 0n;
  for (let i = 0; i < 5; i++) bits = (bits << 8n) | BigInt(digest[i]);
  let text = "";
  for (let i = 7; i >= 0; i--) text += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  return `${text.slice(0, 3)}-${text.slice(3, 6)}`;
}

/** Texto do QR Code de Wi-Fi que a câmera do celular entende (mesmo formato do app Android). */
export function wifiQrPayload(name, password) {
  const escape = (value) => value.replace(/[\\;,:"]/g, (c) => `\\${c}`);
  return password
    ? `WIFI:T:WPA;S:${escape(name)};P:${escape(password)};;`
    : `WIFI:T:nopass;S:${escape(name)};;`;
}

/** Reais com vírgula: 1550 → "R$ 15,50". */
export const brl = (cents) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

export class CloudError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

async function post(path, body, timeoutMs = 20_000) {
  let response;
  try {
    response = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new CloudError("Sem conexão com o servidor do imprime.ai. Confira a internet e tente de novo.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new CloudError(data?.error || `Erro ${response.status} no servidor.`, response.status);
  return data;
}

const credentials = (link) => ({ storeCode: link.storeCode, secret: link.secret });

/** Envia as impressões novas e o que está configurado; devolve plano, código de ativação e configurações do painel. */
export function sync(link, { licenseState, config, jobs }) {
  return post("/api/kiosk/sync", {
    ...credentials(link),
    platform: "web",
    appVersion: APP_VERSION,
    licenseState,
    config,
    configVersion: link.configVersion ?? 0,
    jobs,
  });
}

const pixCall = (link, action, extra = {}) => post("/api/kiosk/pix", { ...credentials(link), action, ...extra });

export const pix = {
  create: (link, sheets) => pixCall(link, "create", { sheets }),
  status: (link, id) => pixCall(link, "status", { id }),
  cancel: (link, id) => pixCall(link, "cancel", { id }),
  consume: (link, id) => pixCall(link, "consume", { id }),
};
