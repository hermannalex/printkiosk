"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  endChallenge,
  requireMaster,
  requireSignedIn,
  revokeSessions,
  startSession,
  takeChallengeAttempt,
} from "@/lib/auth";
import { one, sql } from "@/lib/db";
import { audit, rateLimit } from "@/lib/security";
import {
  hashRecoveryCode,
  looksLikeRecoveryCode,
  newRecoveryCodes,
  openSecret,
  verifyCode,
} from "@/lib/totp";

const masterSecret = () => process.env.SESSION_SECRET ?? "";
const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim().slice(0, 32);
const back = (message: string): never => redirect(`/entrar/codigo?erro=${encodeURIComponent(message)}`);

/**
 * Checks a 6-digit code (or a recovery code) for a user. The code's 30-second step is stored
 * atomically, so the same code cannot be used twice, even by two requests at the same moment.
 */
async function checkSecondFactor(userId: number, input: string): Promise<"code" | "recovery" | null> {
  const user = await one`select totp_secret, totp_last_step from users where id = ${userId} and totp_enabled`;
  if (!user?.totp_secret) return null;

  if (looksLikeRecoveryCode(input)) {
    const used = await one`update users set recovery_codes = array_remove(recovery_codes, ${hashRecoveryCode(input)})
                           where id = ${userId} and ${hashRecoveryCode(input)} = any(recovery_codes) returning id`;
    return used ? "recovery" : null;
  }

  const step = verifyCode(openSecret(user.totp_secret, masterSecret()), input, user.totp_last_step === null ? null : Number(user.totp_last_step));
  if (step === null) return null;
  const claimed = await one`update users set totp_last_step = ${step}
                            where id = ${userId} and (totp_last_step is null or totp_last_step < ${step}) returning id`;
  return claimed ? "code" : null;
}

// ---------------------------------------------------------------- login, second step

export async function verifyLoginCode(form: FormData) {
  const challenge = await takeChallengeAttempt();
  if (!challenge) {
    await endChallenge();
    redirect(`/entrar?erro=${encodeURIComponent("O tempo para o código acabou ou houve tentativas demais. Entre de novo.")}`);
  }
  const { userId, triesLeft } = challenge!;
  if (!(await rateLimit(`mfa:user:${userId}`, 10, 15 * 60))) {
    await endChallenge();
    redirect(`/entrar?erro=${encodeURIComponent("Muitas tentativas. Aguarde alguns minutos e entre de novo.")}`);
  }

  const result = await checkSecondFactor(userId, field(form, "codigo"));
  if (!result) {
    await audit(userId, "mfa_falhou", null, `${triesLeft} tentativa(s) restante(s)`);
    if (triesLeft <= 0) {
      await endChallenge();
      redirect(`/entrar?erro=${encodeURIComponent("Código incorreto vezes demais. Entre de novo.")}`);
    }
    back(`Código incorreto. ${triesLeft} tentativa(s) restante(s).`);
  }

  const user = await one`select role, blocked, cardinality(recovery_codes) as left from users where id = ${userId}`;
  if (!user || user.blocked) back("Conta indisponível.");
  await endChallenge();
  await startSession(userId, user!.role);
  await audit(userId, result === "recovery" ? "login_com_recuperacao" : "login", null, result === "recovery" ? `${user!.left} código(s) de recuperação restante(s)` : null);
  if (result === "recovery") {
    redirect(`/conta/seguranca?msg=${encodeURIComponent(`Você entrou com um código de recuperação. Restam ${user!.left}.`)}`);
  }
  redirect(user!.role === "master" ? "/master" : "/painel");
}

// ---------------------------------------------------------------- setup

export type MfaFormState = { error?: string; codes?: string[] };

export async function confirmMfaSetup(_: MfaFormState, form: FormData): Promise<MfaFormState> {
  const user = await requireSignedIn();
  if (!(await rateLimit(`mfa-setup:user:${user.id}`, 10, 15 * 60))) return { error: "Muitas tentativas. Aguarde alguns minutos." };
  const row = await one`select totp_pending from users where id = ${user.id}`;
  if (!row?.totp_pending) return { error: "Recarregue a página e leia o QR Code de novo." };

  const secret = openSecret(row.totp_pending, masterSecret());
  const step = verifyCode(secret, field(form, "codigo"), null);
  if (step === null) return { error: "Código incorreto. Confira se o relógio do celular está certo e use o código atual." };

  const codes = newRecoveryCodes();
  await sql`update users set totp_secret = ${row.totp_pending}, totp_pending = null, totp_enabled = true,
              totp_last_step = ${step}, recovery_codes = ${codes.map(hashRecoveryCode)}::text[]
            where id = ${user.id}`;
  await audit(user.id, "mfa_ativado", user.email);
  revalidatePath("/conta/seguranca");
  return { codes };
}

export async function regenerateRecoveryCodes(_: MfaFormState, form: FormData): Promise<MfaFormState> {
  const user = await requireSignedIn();
  if (!user.mfaEnabled) return { error: "Ative a verificação em duas etapas primeiro." };
  if (!(await rateLimit(`mfa-setup:user:${user.id}`, 10, 15 * 60))) return { error: "Muitas tentativas. Aguarde alguns minutos." };
  const input = field(form, "codigo");
  if (looksLikeRecoveryCode(input) || (await checkSecondFactor(user.id, input)) !== "code") {
    return { error: "Código do aplicativo incorreto." };
  }
  const codes = newRecoveryCodes();
  await sql`update users set recovery_codes = ${codes.map(hashRecoveryCode)}::text[] where id = ${user.id}`;
  await audit(user.id, "mfa_novos_codigos", user.email);
  return { codes };
}

// ---------------------------------------------------------------- master

/** Lost phone: the master clears the account's 2FA; the owner sets it up again at the next login. */
export async function masterResetMfa(form: FormData) {
  const master = await requireMaster();
  const userId = Number(field(form, "id"));
  if (userId === master.id) redirect(`/master/lojas?erro=${encodeURIComponent("Use outra conta master para redefinir a sua.")}`);
  const row = await one`update users set totp_secret = null, totp_pending = null, totp_enabled = false,
                          totp_last_step = null, recovery_codes = '{}'
                        where id = ${userId} returning email`;
  await revokeSessions(userId);
  await audit(master.id, "mfa_redefinido", row?.email ?? String(userId));
  revalidatePath("/master/lojas");
  redirect(`/master/lojas?msg=${encodeURIComponent("Verificação em duas etapas redefinida. A conta vai configurar de novo no próximo login.")}`);
}
