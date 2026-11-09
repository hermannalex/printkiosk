import QRCode from "qrcode";
import { requireSignedIn } from "@/lib/auth";
import { one } from "@/lib/db";
import { ensurePendingSecret } from "@/lib/mfa";
import { otpauthUrl } from "@/lib/totp";
import { MfaConfirmForm, RegenerateCodesForm } from "@/components/mfa-forms";
import { Flash, BrandMark, Shell, param, type SearchParams } from "@/components/ui";
import { logout } from "../../actions";

export const metadata = { title: "Segurança · imprime.ai" };
export const dynamic = "force-dynamic";

export default async function Security({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSignedIn();
  const params = await searchParams;
  const home = user.role === "master" ? "/master" : "/painel";

  if (user.mfaEnabled) {
    const row = await one`select cardinality(recovery_codes) as left from users where id = ${user.id}`;
    return (
      <Shell user={user} area={user.role === "master" ? "master" : "owner"} current="/conta/seguranca">
        <div className="page-head">
          <div>
            <h1>Segurança</h1>
            <p>Verificação em duas etapas ativa: cada login pede a senha e o código do aplicativo autenticador.</p>
          </div>
        </div>
        <Flash msg={param(params, "msg")} erro={param(params, "erro")} />
        <section className="card stack">
          <h2>Códigos de recuperação</h2>
          <p className="muted">
            Restam <b>{Number(row?.left ?? 0)}</b> de 10. Gere novos se estiverem acabando ou se acha que alguém os viu;
            os antigos deixam de valer.
          </p>
          <RegenerateCodesForm />
        </section>
        <section className="card stack">
          <h2>Trocou de celular?</h2>
          <p className="muted">
            Antes de apagar o aplicativo do celular antigo, fale com o suporte para redefinir a verificação. No próximo
            login você configura o celular novo.
          </p>
        </section>
      </Shell>
    );
  }

  const secret = await ensurePendingSecret(user.id);
  const svg = await QRCode.toString(otpauthUrl(secret, user.email), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  const grouped = secret.match(/.{1,4}/g)?.join(" ") ?? secret;

  return (
    <main className="auth">
      <div className="card auth-card wide">
        <div>
          <h1 className="brand-title"><BrandMark size={36} /> Verificação em duas etapas</h1>
          <p className="muted">
            Obrigatória para usar o painel. Além da senha, cada login vai pedir um código que muda a cada 30 segundos no
            seu celular.
          </p>
        </div>
        <Flash msg={param(params, "msg")} erro={param(params, "erro")} />
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
        <MfaConfirmForm next={{ href: home, label: "Continuar para o painel" }} />
        <form action={logout}>
          <button type="submit" className="btn btn-sm">Sair</button>
        </form>
      </div>
    </main>
  );
}
