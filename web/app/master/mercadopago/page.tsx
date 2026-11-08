import { requireMaster } from "@/lib/auth";
import { checkPermissions, describeToken } from "@/lib/mercadopago";
import { Shell } from "@/components/ui";

export const metadata = { title: "Mercado Pago · Master · Quioco" };
export const dynamic = "force-dynamic";

export default async function MasterMercadoPago() {
  const user = await requireMaster();
  const [info, checks] = await Promise.all([describeToken(), checkPermissions()]);

  return (
    <Shell user={user} area="master" current="/master/mercadopago">
      <div className="page-head">
        <div>
          <h1>Mercado Pago</h1>
          <p>Confere o Access Token cadastrado na Vercel, sem mostrá-lo.</p>
        </div>
      </div>
      <section className="card stack">
        <div>
          <span className={`pill ${info.ok ? "pill-active" : "pill-expired"}`}>
            {info.ok ? "Token aceito pelo Mercado Pago" : "Token recusado"}
          </span>
        </div>
        {info.configured && <p><b>Formato:</b> {info.shape}</p>}
        {info.ok && <p><b>Conta:</b> {info.account}</p>}
        {!info.ok && <p className="muted"><b>Resposta:</b> {info.error}</p>}
        {!info.ok && (
          <div className="small muted stack">
            <p>
              O certo é o <b>Access Token de produção</b>: começa com <span className="mono">APP_USR-</span> e tem cerca de
              70 a 80 caracteres. Ele fica em Suas integrações › sua aplicação › Credenciais de produção.
            </p>
            <p>
              A <b>Public Key</b> também começa com APP_USR-, mas é mais curta (uns 40 caracteres) e não serve aqui.
              Client ID e Client Secret também não.
            </p>
            <p>Depois de trocar na Vercel, é preciso publicar de novo para valer.</p>
          </div>
        )}
      </section>
      {info.configured && (
        <section className="card">
          <h2>Permissões do token</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.label}>
                    <td>{c.label}</td>
                    <td><span className={`pill ${c.ok ? "pill-active" : "pill-expired"}`}>{c.ok ? "ok" : "recusado"}</span></td>
                    <td className="small muted">{c.ok ? "" : c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            "At least one policy returned UNAUTHORIZED" (403) quer dizer que o token é reconhecido, mas o Mercado Pago bloqueou
            aquela operação para esta conta ou aplicação. O que importa para o Quioco são <b>Pagamentos</b> e <b>Assinaturas</b>.
          </p>
        </section>
      )}
    </Shell>
  );
}
