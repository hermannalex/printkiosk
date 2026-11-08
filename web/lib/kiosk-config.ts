/**
 * Kiosk settings that the dashboard can change. The same keys and limits as KioskSettings in the
 * iOS app (KioskStore.swift) and the Android app (Models.kt). Device-only settings stay on the
 * device: the printer (found on the local network), the attendant PIN and the Mercado Pago token.
 */

export type KioskConfig = {
  kioskName: string;
  pricePerPageCents: number;
  maxCopies: number;
  maxItems: number;
  idleTimeoutSeconds: number;
  paymentTimeoutSeconds: number;
  payerEmail: string;
  wifiName: string;
  wifiPassword: string;
};

export const IDLE_OPTIONS = [30, 60, 90, 120, 300] as const;
export const PAYMENT_OPTIONS = [120, 180, 300, 600] as const;
export const DEFAULT_CONFIG: KioskConfig = {
  kioskName: "Estação de Impressão",
  pricePerPageCents: 0,
  maxCopies: 10,
  maxItems: 20,
  idleTimeoutSeconds: 90,
  paymentTimeoutSeconds: 300,
  payerEmail: "",
  wifiName: "",
  wifiPassword: "",
};

const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;
const intIn = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const textUpTo = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : null);

/** Keeps only known keys with valid values (anything else is dropped). */
export function sanitizeConfig(input: unknown): Partial<KioskConfig> {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Partial<KioskConfig> = {};
  const name = textUpTo(o.kioskName, 40);
  if (name) out.kioskName = name;
  const price = intIn(o.pricePerPageCents, 0, 5000);
  if (price !== null) out.pricePerPageCents = price;
  const copies = intIn(o.maxCopies, 1, 50);
  if (copies !== null) out.maxCopies = copies;
  const items = intIn(o.maxItems, 1, 50);
  if (items !== null) out.maxItems = items;
  const idle = intIn(o.idleTimeoutSeconds, 0, 10_000);
  if (idle !== null && (IDLE_OPTIONS as readonly number[]).includes(idle)) out.idleTimeoutSeconds = idle;
  const pay = intIn(o.paymentTimeoutSeconds, 0, 10_000);
  if (pay !== null && (PAYMENT_OPTIONS as readonly number[]).includes(pay)) out.paymentTimeoutSeconds = pay;
  const email = textUpTo(o.payerEmail, 254);
  if (email !== null && (email === "" || EMAIL_RE.test(email))) out.payerEmail = email.toLowerCase();
  const wifi = textUpTo(o.wifiName, 32);
  if (wifi !== null) out.wifiName = wifi;
  const pass = typeof o.wifiPassword === "string" ? o.wifiPassword.slice(0, 63) : null;
  if (pass !== null) out.wifiPassword = pass;
  return out;
}

/** What the form starts with: the dashboard's saved config, else what the kiosk reported, else defaults. */
export function effectiveConfig(saved: unknown, reported: unknown): KioskConfig {
  return { ...DEFAULT_CONFIG, ...sanitizeConfig(reported), ...sanitizeConfig(saved) };
}
