import { createHmac, randomInt } from "node:crypto";

/** Pure helpers for e-mail codes (no database), so tests can load them. */

export type CodePurpose = "login" | "setup";

const pepper = () => process.env.SESSION_SECRET ?? "";

export function hashEmailCode(userId: number, purpose: CodePurpose, code: string, secret = pepper()): string {
  return createHmac("sha256", secret).update(`${userId}:${purpose}:${code}`).digest("hex");
}

export function newEmailCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Only the digits the person typed: "123 456" and "123-456" both count. */
export function normalizeEmailCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

