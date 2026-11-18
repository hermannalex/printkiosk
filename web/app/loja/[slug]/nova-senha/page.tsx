import Link from "next/link";
import { customerResetPassword } from "../../actions";
import { Flash, param, type SearchParams } from "@/components/ui";
import { CUSTOMER_PASSWORD_MIN } from "@/lib/store";

export default async function NewPassword({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const { slug } = await params;
  const query = await searchParams;
  const token = param(query, "t") ?? "";
  return (
    <div className="card auth-card store-auth">
      <div>
        <h1>Criar nova senha</h1>
        <p className="muted">Ao salvar, você entra neste aparelho e sai dos outros.</p>
      </div>
      <Flash erro={param(query, "erro")} />
      {!/^[\w-]{40,60}$/.test(token) ? (
        <p className="notice notice-err">Link incompleto. <Link href={`/loja/${slug}/esqueci`}>Peça um novo link</Link>.</p>
      ) : (
        <form action={customerResetPassword}>
          <input type="hidden" name="loja" value={slug} />
          <input type="hidden" name="t" value={token} />
          <div className="field">
            <label htmlFor="senha">Nova senha</label>
            <input id="senha" name="senha" type="password" autoComplete="new-password" required minLength={CUSTOMER_PASSWORD_MIN} maxLength={128} />
            <span className="small muted">Pelo menos {CUSTOMER_PASSWORD_MIN} caracteres.</span>
          </div>
          <div className="field">
            <label htmlFor="senha2">Repita a nova senha</label>
            <input id="senha2" name="senha2" type="password" autoComplete="new-password" required minLength={CUSTOMER_PASSWORD_MIN} maxLength={128} />
          </div>
          <button className="btn btn-primary" type="submit">Salvar nova senha</button>
        </form>
      )}
    </div>
  );
}
