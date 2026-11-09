import { randomInt } from "node:crypto";

/** No 0/O, 1/I/L: codes are typed on a touch screen and read off paper. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newVoucherCode(): string {
  let text = "";
  for (let i = 0; i < 10; i++) text += ALPHABET[randomInt(ALPHABET.length)];
  return `${text.slice(0, 5)}-${text.slice(5)}`;
}

/** "abcde 23456" → "ABCDE-23456"; null if it can't be a voucher code. */
export function normalizeVoucherCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 10 || [...clean].some((c) => !ALPHABET.includes(c))) return null;
  return `${clean.slice(0, 5)}-${clean.slice(5)}`;
}

export type VoucherStatus = "ativo" | "esgotado" | "vencido" | "desativado";

export function voucherStatus(v: { disabled: boolean; balance_cents: number; expires_on: string | Date | null }, todayIso: string): VoucherStatus {
  if (v.disabled) return "desativado";
  if (Number(v.balance_cents) <= 0) return "esgotado";
  const exp = v.expires_on ? new Date(v.expires_on).toISOString().slice(0, 10) : null;
  if (exp && exp < todayIso) return "vencido";
  return "ativo";
}
