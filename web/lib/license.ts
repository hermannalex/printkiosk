import { createHash, createPrivateKey, sign } from "node:crypto";

/**
 * Activation codes, the same format the apps verify:
 * "PK1-" + base64url(payload + ECDSA P-256 DER signature), where
 * payload = version (1) + store ID (5 bytes) + last valid day (2 bytes, days since 2024-01-01).
 */

const EPOCH_UTC = Date.UTC(2024, 0, 1);
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function normalizeStoreCode(input: string): string | null {
  const cleaned = input.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z2-7]{8}$/.test(cleaned)) return null;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

function storeIdBytes(storeCode: string): Buffer {
  const cleaned = storeCode.replace("-", "");
  let bits = 0n;
  for (const char of cleaned) bits = (bits << 5n) | BigInt(BASE32.indexOf(char));
  const bytes = Buffer.alloc(5);
  for (let i = 4; i >= 0; i--) {
    bytes[i] = Number(bits & 0xffn);
    bits >>= 8n;
  }
  return bytes;
}

/** "2026-12-31" → day number since 2024-01-01 */
export function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / 86_400_000);
}

function privateKey() {
  const pem = process.env.LICENSE_PRIVATE_KEY;
  if (!pem) throw new Error("LICENSE_PRIVATE_KEY não configurada.");
  return createPrivateKey(pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem);
}

/** Signs an activation code for a kiosk, valid until `untilIso` (inclusive). */
export function makeActivationCode(storeCode: string, untilIso: string): string {
  const days = dayNumber(untilIso);
  if (days < 0 || days > 0xffff) throw new Error("Data fora do intervalo aceito.");
  const payload = Buffer.concat([Buffer.from([1]), storeIdBytes(storeCode), Buffer.from([days >> 8, days & 0xff])]);
  const signature = sign("sha256", payload, privateKey()); // DER by default for EC keys
  return "PK1-" + Buffer.concat([payload, signature]).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Six-character code the kiosk shows in its (PIN-protected) settings. Adding a kiosk to an
 * account requires it, so knowing a store code is not enough to take over someone's kiosk.
 * Same derivation in the apps: base32(sha256("pair:" + sha256hex(secret))), first 6 chars.
 */
export function pairingCode(secretHash: string): string {
  const digest = createHash("sha256").update(`pair:${secretHash}`).digest();
  let bits = 0n;
  for (let i = 0; i < 5; i++) bits = (bits << 8n) | BigInt(digest[i]);
  let text = "";
  for (let i = 7; i >= 0; i--) text += BASE32[Number((bits >> BigInt(i * 5)) & 31n)];
  return `${text.slice(0, 3)}-${text.slice(3, 6)}`;
}

export function normalizePairingCode(input: string): string {
  const cleaned = input.replace(/[\s-]/g, "").toUpperCase().slice(0, 6);
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
}
