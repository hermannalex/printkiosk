import Link from "next/link";
import QRCode from "qrcode";
import { requireSignedIn } from "@/lib/auth";
import { one } from "@/lib/db";
import { emailConfigured } from "@/lib/email";
import { ensurePendingSecret } from "@/lib/mfa";
import { otpauthUrl } from "@/lib/totp";
import { EmailMfaConfirmForm, MfaConfirmForm, RegenerateCodesForm } from "@/components/mfa-forms";
import { Flash, BrandMark, Shell, param, type SearchParams } from "@/components/ui";
import { sendSetupEmailCode } from "../../mfa-actions";
import { logout } from "../../actions";

export const metadata = { title: "Segurança · imprime.ai" };
export const dynamic = "force-dynamic";

/** QR Code and steps to add the account to an authenticator app, then the 6-digit confirmation. */
async function AppSetup({ userId, email, next }: { userId: number; email: string; next: { href: string; label: string } }) {
  const secret = await ensurePendingSecret(userId);
  const svg = await QRCode.toString(otpauthUrl(secret, email), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  const grouped = secret.match(/.{1,4}/g)?.join(" ") ?? secret;
  return (
    <>
      <ol className="steps">
        <li>
          Instale um aplicativo autenticador: Google Authenticator, Microsoft Authenticator ou o do seu gerenciador
          de senhas.
        </li>
        <li>
          No aplicativo, toque em adicionar e leia este QR Code:
          <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
          <span className="small muted">Não consegue ler? Digite a chave: </span>
          <span className="mono small">{grouped}</span>
        </li>
        <li>Digite o código de 6 números que aparece no aplicativo:</li>
      </ol>
      <MfaConfirmForm next={next} />
    </>
  );
}

/** Send a code to the account's inbox, then type it to turn the e-mail factor on. */
function EmailSetup({ email, sent, next }: { email: string; sent: boolean; next: { href: string; label: string } }) {
  if (!emailConfigured()) {
    return <div className="notice notice-err">O envio de e-mail ainda não está configurado. Use o aplicativo autenticador.</div>;
  }
  return (
    <div className="stack">
      <p className="muted">
        A cada login enviamos um código de 6 números para <b>{email}</b>. Ele vale por 10 minutos e só funciona uma vez.
      </p>
      <form action={sendSetupEmailCode}>
        <input type="hidden" name="next" value="email" />
        <button className={sent ? "btn btn-sm" : "btn btn-primary"} type="submit">
          {sent ? "Enviar outro código" : "Enviar código para meu e-mail"}
        </button>
      </form>
      {sent && <EmailMfaConfirmForm next={next} />}
    </div>
  );
}

export default async function Security({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSignedIn();
  const params = await searchParams;
  const home = user.role === "master" ? "/master" : "/painel";
  const wantsEmail = param(params, "email") === "1";
  const wantsApp = param(params, "app") === "1";
  const sent = !!param(params, "msg") && wantsEmail;

  if (user.mfaEnabled) {
    const row = await one`select cardinality(recovery_codes) as left from users where id = ${user.id}`;
    const byEmail = user.mfaMethod === "email";
    return (
      <Shell user={user} area={user.role === "master" ? "master" : "owner"} current="/conta/seguranca">
        <div className="page-head">
          <div>
            <h1>Segurança</h1>
            <p>
              Verificação em duas etapas ativa: cada login pede a senha e{" "}
              {byEmail ? <>um código enviado para <b>{user.email}</b>.</> : "o código do aplicativo autenticador."}
            </p>
          </div>
        </div>
        <Flash msg={param(params, "msg")} erro={param(params, "erro")} />

        <section className="card stack">
          <h2>Códigos de recuperação</h2>
          <p className="muted">
            Restam <b>{Number(row?.left ?? 0)}</b> de 10. Gere novos se estiverem acabando ou se acha que alguém os viu;
            os antigos deixam de valer.
          </p>
          {byEmail && (
            <form action={sendSetupEmailCode}>
              <input type="hidden" name="next" value="codigos" />
              <button className="btn btn-sm" type="submit">Enviar código para confirmar</button>
            </form>
          )}
          <RegenerateCodesForm method={byEmail ? "email" : "app"} />
        </section>

        <section className="card stack">
          <h2>Forma de verificação</h2>
          {byEmail ? (
            wantsApp ? (
              <>
                <p className="muted">Ao confirmar, o login passa a pedir o código do aplicativo e não envia mais e-mail.</p>
                <AppSetup userId={user.id} email={user.email} next={{ href: "/conta/seguranca", label: "Concluir" }} />
              </>
            ) : (
              <p className="muted">
                Você recebe o código por e-mail. Um aplicativo autenticador é mais seguro: funciona sem internet e não
                depende da senha do seu e-mail. <Link href="/conta/seguranca?app=1">Usar aplicativo autenticador</Link>
              </p>
            )
          ) : wantsEmail ? (
            <>
              <p className="muted">Ao confirmar, o login passa a pedir um código enviado por e-mail no lugar do aplicativo.</p>
              <EmailSetup email={user.email} sent={sent} next={{ href: "/conta/seguranca", label: "Concluir" }} />
            </>
          ) : (
            <p className="muted">
              Você usa um aplicativo autenticador. Trocou de celular? Antes de apagar o aplicativo do celular antigo,
              passe para o código por e-mail ou fale com o suporte.{" "}
              <Link href="/conta/seguranca?email=1">Receber o código por e-mail</Link>
            </p>
          )}
        </section>
      </Shell>
    );
  }

  const next = { href: home, label: "Continuar para o painel" };
  return (
    <main className="auth">
      <div className="card auth-card wide">
        <div>
          <h1 className="brand-title"><BrandMark size={36} /> Verificação em duas etapas</h1>
          <p className="muted">
            Obrigatória para usar o painel. Além da senha, cada login vai pedir um código de 6 números.
          </p>
        </div>
        <nav className="nav" aria-label="Forma de verificação">
          <Link href="/conta/seguranca" aria-current={wantsEmail ? undefined : "page"}>Aplicativo autenticador</Link>
          <Link href="/conta/seguranca?email=1" aria-current={wantsEmail ? "page" : undefined}>Código por e-mail</Link>
        </nav>
        <Flash msg={param(params, "msg")} erro={param(params, "erro")} />
        {wantsEmail ? (
          <EmailSetup email={user.email} sent={sent} next={next} />
        ) : (
          <>
            <p className="small muted">Recomendado: o código muda a cada 30 segundos no seu celular, mesmo sem internet.</p>
            <AppSetup userId={user.id} email={user.email} next={next} />
          </>
        )}
        <form action={logout}>
          <button type="submit" className="btn btn-sm">Sair</button>
        </form>
      </div>
    </main>
  );
}
