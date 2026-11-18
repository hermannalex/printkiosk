import Link from "next/link";
import { customerForgot } from "../../actions";
import { Flash, param, type SearchParams } from "@/components/ui";

export default async function ForgotPassword({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const { slug } = await params;
  const query = await searchParams;
  const sent = param(query, "enviado") === "1";
  return (
    <div className="card auth-card store-auth">
      <div>
        <h1>Esqueci minha senha</h1>
        <p className="muted">Digite o e-mail do seu cadastro. Enviamos um link para você criar uma senha nova.</p>
      </div>
      <Flash erro={param(query, "erro")} />
      {sent ? (
        <p className="notice notice-ok" role="status">
          Se este e-mail tiver cadastro nesta loja, o link chega em instantes. Confira também a caixa de spam. O link vale por 1 hora.
        </p>
      ) : (
        <form action={customerForgot}>
          <input type="hidden" name="loja" value={slug} />
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
          </div>
          <button className="btn btn-primary" type="submit">Enviar link</button>
        </form>
      )}
      <p className="small muted"><Link href={`/loja/${slug}/entrar`}>Voltar para entrar</Link></p>
    </div>
  );
}
