import Link from "next/link";
import { redirect } from "next/navigation";
import { resendLoginCode, verifyLoginCode } from "../../mfa-actions";
import { challengeUserId } from "@/lib/auth";
import { one } from "@/lib/db";
import { maskEmail } from "@/lib/email";
import { Flash, BrandMark, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Código de verificação · imprime.ai" };
export const dynamic = "force-dynamic";

export default async function SecondFactor({ searchParams }: { searchParams: SearchParams }) {
  const userId = await challengeUserId();
  if (!userId) redirect("/entrar");
  const params = await searchParams;
  const user = await one`select email, totp_enabled, email_mfa_enabled from users where id = ${userId}`;
  const byEmail = !!user && !user.totp_enabled && !!user.email_mfa_enabled;

  return (
    <main className="auth">
      <div className="card auth-card">
        <div>
          <h1 className="brand-title"><BrandMark size={36} /> Verificação</h1>
          {byEmail ? (
            <p className="muted">
              Enviamos um código de 6 números para <b>{maskEmail(user!.email)}</b>. Ele vale por 10 minutos. Confira
              também a caixa de spam.
            </p>
          ) : (
            <p className="muted">Abra o aplicativo autenticador no celular e digite o código de 6 números do imprime.ai.</p>
          )}
        </div>
        <Flash msg={param(params, "msg")} erro={param(params, "erro")} />
        <form action={verifyLoginCode}>
          <div className="field">
            <label htmlFor="codigo">{byEmail ? "Código do e-mail" : "Código"}</label>
            <input
              id="codigo"
              name="codigo"
              className="mono code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{3}[ \-]?[0-9]{3}|[A-Za-z2-7]{4}-?[A-Za-z2-7]{4}"
              maxLength={9}
              required
              autoFocus
            />
          </div>
          <button className="btn btn-primary" type="submit">Confirmar</button>
        </form>
        {byEmail && (
          <form action={resendLoginCode}>
            <button className="btn btn-sm" type="submit">Não chegou? Enviar outro código</button>
          </form>
        )}
        <p className="small muted">
          {byEmail ? "Sem acesso ao e-mail?" : "Sem o celular?"} Digite um dos códigos de recuperação (como{" "}
          <span className="mono">K7QD-M2XP</span>) no mesmo campo. Perdeu os dois? Fale com o suporte para redefinir.
        </p>
        <p className="small"><Link href="/entrar">Voltar</Link></p>
      </div>
    </main>
  );
}
