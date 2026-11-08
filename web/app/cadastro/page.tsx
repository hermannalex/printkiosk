import Link from "next/link";
import { register } from "../actions";
import { Flash, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Criar conta · PrintKiosk" };

export default async function SignUp({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <main className="auth">
      <div className="card auth-card">
        <div>
          <h1>Criar conta da loja</h1>
          <p className="muted">
            Com a conta você assina o PrintKiosk, recebe o código do quiosque automaticamente e, no plano Pro,
            acompanha cópias e faturamento.
          </p>
        </div>
        <Flash msg={param(params, "msg")} erro={param(params, "erro")} />
        <form action={register}>
          <div className="field">
            <label htmlFor="nome">Nome da loja ou responsável</label>
            <input id="nome" name="nome" required autoComplete="organization" />
          </div>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="telefone">WhatsApp (opcional)</label>
            <input id="telefone" name="telefone" type="tel" autoComplete="tel" />
          </div>
          <div className="field">
            <label htmlFor="senha">Senha (8 ou mais caracteres)</label>
            <input id="senha" name="senha" type="password" minLength={8} required autoComplete="new-password" />
          </div>
          <details>
            <summary className="small muted">Sou o administrador do PrintKiosk</summary>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="codigo_master">Código de configuração do master</label>
              <input id="codigo_master" name="codigo_master" autoComplete="off" />
            </div>
          </details>
          <button className="btn btn-primary" type="submit">Criar conta</button>
        </form>
        <p className="small muted">
          Já tem conta? <Link href="/entrar">Entrar</Link>
        </p>
      </div>
    </main>
  );
}
