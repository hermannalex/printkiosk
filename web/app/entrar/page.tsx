import Link from "next/link";
import { login } from "../actions";
import { GoogleButton } from "@/components/google-button";
import { Flash, BrandMark, Wordmark, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Entrar · imprime.ai" };

export default async function SignIn({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <main className="auth">
      <div className="card auth-card">
        <div>
          <h1 className="brand-title"><BrandMark size={36} /> <Wordmark /></h1>
          <p className="muted">Entre para ver os quiosques, as assinaturas e o faturamento da sua loja.</p>
        </div>
        <Flash msg={param(params, "msg")} erro={param(params, "erro")} />
        <GoogleButton from="entrar" label="Entrar com Google" />
        <form action={login}>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="senha">Senha</label>
            <input id="senha" name="senha" type="password" autoComplete="current-password" maxLength={128} required />
          </div>
          <button className="btn btn-primary" type="submit">Entrar</button>
        </form>
        <p className="small muted">
          Ainda não tem conta? <Link href="/cadastro">Criar conta da loja</Link>
        </p>
      </div>
    </main>
  );
}
