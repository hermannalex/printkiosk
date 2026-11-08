import Link from "next/link";
import { redirect } from "next/navigation";
import { verifyLoginCode } from "../../mfa-actions";
import { hasChallenge } from "@/lib/auth";
import { Flash, QuiocoMark, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Código de verificação · Quioco" };

export default async function SecondFactor({ searchParams }: { searchParams: SearchParams }) {
  if (!(await hasChallenge())) redirect("/entrar");
  const params = await searchParams;
  return (
    <main className="auth">
      <div className="card auth-card">
        <div>
          <h1 className="brand-title"><QuiocoMark size={36} /> Verificação</h1>
          <p className="muted">Abra o aplicativo autenticador no celular e digite o código de 6 números do Quioco.</p>
        </div>
        <Flash erro={param(params, "erro")} />
        <form action={verifyLoginCode}>
          <div className="field">
            <label htmlFor="codigo">Código</label>
            <input
              id="codigo"
              name="codigo"
              className="mono code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}|[A-Za-z2-7]{4}-?[A-Za-z2-7]{4}"
              maxLength={9}
              required
              autoFocus
            />
          </div>
          <button className="btn btn-primary" type="submit">Confirmar</button>
        </form>
        <p className="small muted">
          Sem o celular? Digite um dos códigos de recuperação (como <span className="mono">K7QD-M2XP</span>) no mesmo
          campo. Perdeu os dois? Fale com o suporte para redefinir.
        </p>
        <p className="small"><Link href="/entrar">Voltar</Link></p>
      </div>
    </main>
  );
}
