import Link from "next/link";
import { forgotPassword } from "../../reset-actions";
import { Flash, BrandMark, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Esqueci minha senha · imprime.ai" };

export default async function Forgot({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const sent = param(params, "enviado") === "1";
  return (
    <main className="auth">
      <div className="card auth-card">
        <div>
          <h1 className="brand-title"><BrandMark size={36} /> Esqueci minha senha</h1>
          <p className="muted">Digite o e-mail da sua conta. Enviamos um link para criar uma nova senha.</p>
        </div>
        <Flash erro={param(params, "erro")} />
        {sent ? (
          <p className="notice">
            Se existir uma conta com esse e-mail, o link já está a caminho. Ele vale por 1 hora. Confira também a caixa de spam.
          </p>
        ) : (
          <form action={forgotPassword}>
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" autoComplete="email" required autoFocus />
            </div>
            <button className="btn btn-primary" type="submit">Enviar link</button>
          </form>
        )}
        <p className="small"><Link href="/entrar">Voltar para entrar</Link></p>
      </div>
    </main>
  );
}
