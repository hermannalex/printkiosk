import { one, sql } from "./db";
import { newSecret, openSecret, sealSecret } from "./totp";
import { issueEmailCode } from "./email-code";

/** Server-only helpers for 2FA setup (kept out of "use server" files, which expose every export). */

const masterSecret = () => process.env.SESSION_SECRET ?? "";

/** Creates the secret shown as a QR Code (not active until a code from the app confirms it). */
export async function ensurePendingSecret(userId: number): Promise<string> {
  const row = await one`select totp_pending from users where id = ${userId}`;
  if (row?.totp_pending) {
    try {
      return openSecret(row.totp_pending, masterSecret());
    } catch {
      // Sealed with another SESSION_SECRET: start over below.
    }
  }
  const secret = newSecret();
  await sql`update users set totp_pending = ${sealSecret(secret, masterSecret())} where id = ${userId}`;
  return secret;
}


/**
 * Login with the e-mail factor: send the code right when the password (or Google) is accepted.
 * A failure is not fatal; the code page shows a button to send it again.
 */
export async function sendLoginEmailCode(userId: number): Promise<void> {
  const result = await issueEmailCode(userId, "login");
  if (!result.ok) console.error("login email code", userId, result.error);
}
