"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { PASSWORD_MAX, PASSWORD_MIN, hashPassword } from "@/lib/auth";
import { one, sql } from "@/lib/db";
import { emailConfigured, sendEmail } from "@/lib/email";
import { audit, clientIp, rateLimit } from "@/lib/security";
import { PUBLIC_URL } from "@/lib/store";
import { simpleEmail } from "@/lib/store-pix";

/**
 * "Esqueci minha senha" for the portal (owners and master). The link only sets a new password:
 * it never turns off two-factor, so someone with the mailbox still needs the second factor to get in.
 */

const RESET_MINUTES = 60;
const TOO_MANY = "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;
const text = (form: FormData, key: string, max = 200) => String(form.get(key) ?? "").trim().slice(0, max);
const resetHash = (token: string) => createHash("sha256").update(token).digest("hex");
const go = (path: string, kind: "msg" | "erro", message: string, extra = ""): never =>
  redirect(`${path}?${kind}=${encodeURIComponent(message)}${extra}`);

/** Same answer whether or not the e-mail has an account, so the form can't be used to find out who is a customer. */
export async function forgotPassword(form: FormData) {
  const email = text(form, "email", 254).toLowerCase();
  if (!EMAIL_RE.test(email)) go("/entrar/esqueci", "erro", "Digite um e-mail válido.");
  const ip = await clientIp();
  if (!(await rateLimit(`pw-forgot:ip:${ip}`, 10, 3600)) || !(await rateLimit(`pw-forgot:${email}`, 3, 3600))) {
    go("/entrar/esqueci", "erro", TOO_MANY);
  }

  const user = await one`select id, name from users where email = ${email} and not blocked`;
  if (user && emailConfigured()) {
    const token = randomBytes(32).toString("base64url");
    await sql`delete from user_password_resets where expires_at < now() - interval '1 day'`;
    await sql`update user_password_resets set used_at = now() where user_id = ${user.id} and used_at is null`;
    await sql`insert into user_password_resets (token_hash, user_id, expires_at)
              values (${resetHash(token)}, ${user.id}, now() + make_interval(mins => ${RESET_MINUTES}))`;
    const first = String(user.name).split(/\s+/)[0];
    const body = simpleEmail(
      "Criar uma nova senha",
      [
        `Olá, ${first}! Recebemos um pedido para trocar a senha da sua conta no imprime.ai.`,
        `O link vale por ${RESET_MINUTES} minutos e só pode ser usado uma vez.`,
        "Se não foi você, ignore este e-mail: sua senha continua a mesma.",
      ],
      { href: `${PUBLIC_URL}/entrar/nova-senha?t=${token}`, label: "Criar nova senha" },
    );
    try {
      await sendEmail({ to: email, subject: "Nova senha · imprime.ai", ...body });
    } catch (error) {
      console.error("portal reset e-mail", error);
    }
  }
  await audit(user ? Number(user.id) : null, "senha_redefinicao_pedida", email, `ip ${ip}`);
  redirect("/entrar/esqueci?enviado=1");
}

export async function resetPassword(form: FormData) {
  const token = text(form, "t", 100);
  const password = String(form.get("senha") ?? "");
  const again = String(form.get("senha2") ?? "");
  const keep = `&t=${encodeURIComponent(token)}`;
  const ip = await clientIp();
  if (!(await rateLimit(`pw-reset:ip:${ip}`, 20, 3600))) go("/entrar/nova-senha", "erro", TOO_MANY, keep);
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    go("/entrar/nova-senha", "erro", `A senha precisa ter de ${PASSWORD_MIN} a ${PASSWORD_MAX} caracteres.`, keep);
  }
  if (password !== again) go("/entrar/nova-senha", "erro", "As duas senhas não são iguais.", keep);

  // The link is spent in the same statement that checks it, so two requests cannot both use it.
  const row = await one`
    update user_password_resets r set used_at = now()
    from users u
    where r.token_hash = ${resetHash(token)} and r.used_at is null and r.expires_at > now()
      and u.id = r.user_id and not u.blocked
    returning r.user_id, u.email`;
  if (!row) go("/entrar/esqueci", "erro", "Este link expirou ou já foi usado. Peça um novo.");

  const userId = Number(row!.user_id);
  const email = String(row!.email);
  const localPart = email.split("@")[0].toLowerCase();
  const lowered = password.toLowerCase();
  if (lowered === email.toLowerCase() || (localPart.length >= 4 && lowered.includes(localPart)) || /^(.)\1+$/.test(password)) {
    // The link was spent above: give a fresh one rather than letting a weak password through.
    await sql`update user_password_resets set used_at = null where token_hash = ${resetHash(token)}`;
    go("/entrar/nova-senha", "erro", "Escolha uma senha que não repita o seu e-mail nem um único caractere.", keep);
  }

  await sql`update users set password_hash = ${hashPassword(password)} where id = ${userId}`;
  await sql`delete from sessions where user_id = ${userId}`;        // signs out every device
  await sql`delete from login_challenges where user_id = ${userId}`; // and drops a half-finished login
  await sql`update user_password_resets set used_at = now() where user_id = ${userId} and used_at is null`;
  await audit(userId, "senha_redefinida", email, `ip ${ip}`);
  go("/entrar", "msg", "Senha trocada. Entre com a nova senha.");
}
