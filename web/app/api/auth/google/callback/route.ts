import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { startChallenge, startSession } from "@/lib/auth";
import { one } from "@/lib/db";
import { finishGoogle, readCookie } from "@/lib/google";
import { audit, safeEqual } from "@/lib/security";
import { sendLoginEmailCode } from "@/lib/mfa";

export const dynamic = "force-dynamic";
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-pk_oauth" : "pk_oauth";
const fail = (to: string, text: string): never => redirect(`/${to}?erro=${encodeURIComponent(text)}`);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = await cookies();
  const saved = readCookie(store.get(COOKIE)?.value);
  store.delete(COOKIE);
  const back = saved?.intent ?? "entrar";

  if (url.searchParams.get("error")) fail(back, "Entrada com Google cancelada.");
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!saved || !code || !safeEqual(state, saved.state)) fail(back, "A entrada com Google expirou. Tente de novo.");

  let profile: { sub: string; email: string; name: string };
  try {
    profile = await finishGoogle(code.slice(0, 2048), saved!.verifier, saved!.nonce);
  } catch (error) {
    await audit(null, "google_falhou", null, error instanceof Error ? error.message : String(error));
    return fail(back, "Não foi possível confirmar sua conta Google. Tente de novo.");
  }

  // 1) Already linked. 2) Same verified e-mail as an existing account: link it. 3) New store owner.
  let user = await one`select id, role, blocked, totp_enabled, email_mfa_enabled, email from users where google_sub = ${profile.sub}`;
  if (!user) {
    user = await one`update users set google_sub = ${profile.sub} where email = ${profile.email} and google_sub is null
                     returning id, role, blocked, totp_enabled, email_mfa_enabled, email`;
    if (user) await audit(Number(user.id), "google_vinculado", profile.email);
  }
  if (!user) {
    const masterEmail = (process.env.MASTER_EMAIL ?? "").toLowerCase();
    if (masterEmail && profile.email === masterEmail) {
      await audit(null, "cadastro_master_recusado", profile.email, "via Google");
      fail(back, "Este e-mail é reservado.");
    }
    // No password: "google$…" is not a scheme verifyPassword accepts, so only Google can sign in.
    user = await one`insert into users (email, name, password_hash, role, google_sub)
                     values (${profile.email}, ${profile.name}, ${"google$" + randomBytes(16).toString("hex")}, 'owner', ${profile.sub})
                     on conflict (email) do nothing returning id, role, blocked, totp_enabled, email_mfa_enabled, email`;
    if (!user) fail(back, "Já existe uma conta com este e-mail. Entre com sua senha.");
    await audit(Number(user!.id), "cadastro", profile.email, "via Google");
  }

  if (user!.blocked) {
    await audit(Number(user!.id), "login_falhou", profile.email, "conta bloqueada (Google)");
    fail("entrar", "Conta indisponível.");
  }
  // Google replaces the password, not the second factor.
  if (user!.totp_enabled || user!.email_mfa_enabled) {
    await startChallenge(Number(user!.id));
    await audit(Number(user!.id), "senha_ok", profile.email, "Google ok, aguardando o segundo fator");
    if (!user!.totp_enabled) await sendLoginEmailCode(Number(user!.id));
    redirect("/entrar/codigo");
  }
  await startSession(Number(user!.id), user!.role);
  await audit(Number(user!.id), "login_sem_2fa", profile.email, "via Google");
  redirect("/conta/seguranca?msg=" + encodeURIComponent("Conta Google conectada. Agora ative a verificação em duas etapas."));
}
