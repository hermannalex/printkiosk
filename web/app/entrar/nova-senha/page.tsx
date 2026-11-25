import Link from "next/link";
import { resetPassword } from "../../reset-actions";
import { Flash, BrandMark, param, type SearchParams } from "@/components/ui";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth";

export const metadata = { title: "Nova senha · imprime.ai" };

export default async function NewPassword({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = param(params, "t") ?? "";
  return (
    <main className="auth">
      <div className="card auth-card">
        <div>
          <h1 className="brand-title"><BrandMark size={36} /> Nova senha</h1>
          <p className="muted">
            Ao salvar, você sai de todos os aparelhos. A verificação em duas etapas continua valendo no próximo login.
          </p>
        </div>
        <Flash erro={param(params, "erro")} />
        {!/^[\w-]{40,60}$/.test(token) ? (
          <p className="notice notice-err">Link incompleto. <Link href="/entrar/esqueci">Peça um novo link</Link>.</p>
        ) : (
          <form action={resetPassword}>
            <input type="hidden" name="t" value={token} />
            <div className="field">
              <label htmlFor="senha">Nova senha</label>
              <input id="senha" name="senha" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoFocus />
              <span className="small muted">De {PASSWORD_MIN} a {PASSWORD_MAX} caracteres.</span>
            </div>
            <div className="field">
              <label htmlFor="senha2">Repita a nova senha</label>
              <input id="senha2" name="senha2" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} />
            </div>
            <button className="btn btn-primary" type="submit">Salvar nova senha</button>
          </form>
        )}
      </div>
    </main>
  );
}
