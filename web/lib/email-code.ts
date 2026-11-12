import { one, sql } from "./db";
import { codeEmail, emailConfigured, sendEmail } from "./email";
import { rateLimit } from "./security";
import { hashEmailCode, newEmailCode, normalizeEmailCode, type CodePurpose } from "./email-code-core";

/**
 * One-time codes sent by e-mail, the second factor for accounts that chose e-mail over an
 * authenticator app. Server-only (kept out of "use server" files, which expose every export).
 *
 * - 6 digits, valid 10 minutes, one use, at most 5 wrong tries per code.
 * - Stored only as an HMAC keyed with SESSION_SECRET, bound to the user and the purpose.
 * - A new code replaces the previous one; a new one can be sent every 60 s, 5 per 15 min.
 */

export type { CodePurpose };
export const EMAIL_CODE_MINUTES = 10;
export const EMAIL_CODE_TRIES = 5;
const RESEND_COOLDOWN_SECONDS = 60;

export type IssueResult = { ok: true } | { ok: false; error: string };

/** Creates a code for the user, replacing any earlier one for the same purpose, and e-mails it. */
export async function issueEmailCode(userId: number, purpose: CodePurpose): Promise<IssueResult> {
  if (!emailConfigured()) return { ok: false, error: "O envio de e-mail ainda não está configurado. Fale com o suporte." };

  const user = await one`select email, name from users where id = ${userId} and not blocked`;
  if (!user) return { ok: false, error: "Conta indisponível." };

  const last = await one`select extract(epoch from now() - sent_at)::int as age from email_codes
                         where user_id = ${userId} and purpose = ${purpose}`;
  if (last && Number(last.age) < RESEND_COOLDOWN_SECONDS) {
    return { ok: false, error: `Aguarde ${RESEND_COOLDOWN_SECONDS - Number(last.age)} segundos para pedir outro código.` };
  }
  if (!(await rateLimit(`email-code:user:${userId}`, 5, 15 * 60))) {
    return { ok: false, error: "Muitos códigos pedidos. Aguarde 15 minutos." };
  }

  const code = newEmailCode();
  await sql`insert into email_codes (user_id, purpose, code_hash, expires_at, attempts, sent_at)
            values (${userId}, ${purpose}, ${hashEmailCode(userId, purpose, code)},
                    now() + make_interval(mins => ${EMAIL_CODE_MINUTES}), 0, now())
            on conflict (user_id, purpose) do update set code_hash = excluded.code_hash,
              expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`;
  try {
    await sendEmail({ to: user.email, ...codeEmail(code, purpose, user.name) });
  } catch (error) {
    console.error("email-code", error);
    await sql`delete from email_codes where user_id = ${userId} and purpose = ${purpose}`;
    return { ok: false, error: "Não foi possível enviar o e-mail agora. Tente de novo em instantes." };
  }
  return { ok: true };
}

/**
 * True when `input` is the current code. A right code is deleted in the same statement that
 * matches it, so two requests at the same moment cannot both use it; a wrong one counts a try.
 */
export async function checkEmailCode(userId: number, purpose: CodePurpose, input: string): Promise<boolean> {
  const code = normalizeEmailCode(input);
  if (!code) return false;
  const used = await one`delete from email_codes
                         where user_id = ${userId} and purpose = ${purpose} and code_hash = ${hashEmailCode(userId, purpose, code)}
                           and expires_at > now() and attempts < ${EMAIL_CODE_TRIES}
                         returning user_id`;
  if (used) return true;
  await sql`update email_codes set attempts = attempts + 1 where user_id = ${userId} and purpose = ${purpose}`;
  return false;
}
