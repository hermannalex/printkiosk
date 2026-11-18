import Link from "next/link";
import { customerSignup } from "../../actions";
import { Flash, param, type SearchParams } from "@/components/ui";
import { CUSTOMER_PASSWORD_MIN } from "@/lib/store";

export default async function CustomerSignUp({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const { slug } = await params;
  const query = await searchParams;
  const next = param(query, "next") ?? "";
  return (
    <div className="card auth-card store-auth">
      <div>
        <h1>Criar cadastro</h1>
        <p className="muted">Para acompanhar seus pedidos e receber o aviso quando ficarem prontos.</p>
      </div>
      <Flash erro={param(query, "erro")} />
      <form action={customerSignup}>
        <input type="hidden" name="loja" value={slug} />
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="nome">Nome</label>
          <input id="nome" name="nome" autoComplete="name" required maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
        </div>
        <div className="field">
          <label htmlFor="senha">Senha</label>
          <input id="senha" name="senha" type="password" autoComplete="new-password" required minLength={CUSTOMER_PASSWORD_MIN} maxLength={128} />
          <span className="small muted">Pelo menos {CUSTOMER_PASSWORD_MIN} caracteres.</span>
        </div>
        <button className="btn btn-primary" type="submit">Criar cadastro</button>
      </form>
      <p className="small muted">
        Já tem cadastro? <Link href={`/loja/${slug}/entrar${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Entrar</Link>
      </p>
      <p className="small muted">Seus dados são usados só para os pedidos nesta loja. <a href="https://imprime.ai/privacidade.html" target="_blank" rel="noopener">Privacidade</a></p>
    </div>
  );
}
