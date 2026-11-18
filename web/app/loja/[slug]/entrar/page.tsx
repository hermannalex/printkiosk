import Link from "next/link";
import { customerLogin } from "../../actions";
import { Flash, param, type SearchParams } from "@/components/ui";

export default async function CustomerSignIn({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const { slug } = await params;
  const query = await searchParams;
  const next = param(query, "next") ?? "";
  return (
    <div className="card auth-card store-auth">
      <div>
        <h1>Entrar</h1>
        <p className="muted">Use o e-mail e a senha do seu cadastro nesta loja.</p>
      </div>
      <Flash erro={param(query, "erro")} msg={param(query, "msg")} />
      <form action={customerLogin}>
        <input type="hidden" name="loja" value={slug} />
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
        </div>
        <div className="field">
          <label htmlFor="senha">Senha</label>
          <input id="senha" name="senha" type="password" autoComplete="current-password" required maxLength={128} />
        </div>
        <button className="btn btn-primary" type="submit">Entrar</button>
      </form>
      <p className="small muted">
        Primeira vez? <Link href={`/loja/${slug}/cadastro${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Criar cadastro</Link>
      </p>
    </div>
  );
}
