import Link from "next/link";
import { addKiosk } from "../../actions";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { ago, brl, dateBR } from "@/lib/format";
import { kioskStatus } from "@/lib/kiosks";
import { Flash, PlanPill, Shell, StatusPill, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Quiosques · imprime.ai" };
export const dynamic = "force-dynamic";

/** What the kiosk charges: the dashboard's price once saved, otherwise what the kiosk reported. */
const pagePrice = (k: Record<string, any>) => {
  const cents = (k.config_version > 0 ? k.config?.pricePerPageCents : null) ?? k.reported_config?.pricePerPageCents;
  return cents == null ? "—" : Number(cents) === 0 ? "grátis" : brl(cents);
};

export default async function OwnerKiosks({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const kiosks = await sql`select * from kiosks where owner_id = ${user.id} order by created_at`;

  return (
    <Shell user={user} area="owner" current="/painel/quiosques">
      <div className="page-head">
        <div>
          <h1>Quiosques e assinatura</h1>
          <p>Cada aparelho tem o seu código da loja e a sua assinatura.</p>
        </div>
      </div>
      <Flash msg={param(params, "msg")} erro={param(params, "erro")} />

      <section className="card">
        <div className="card-head"><h2>Seus quiosques</h2></div>
        {kiosks.length === 0 ? (
          <p className="empty">Nenhum quiosque ainda. Adicione abaixo com o código da loja.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Quiosque</th>
                  <th>Código da loja</th>
                  <th>Plano</th>
                  <th>Situação</th>
                  <th>Válido até</th>
                  <th>Preço/página</th>
                  <th>Última conexão</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {kiosks.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td className="mono">{k.store_code}</td>
                    <td><PlanPill plan={k.plan} /></td>
                    <td><StatusPill status={kioskStatus(k)} /></td>
                    <td className="mono">{dateBR(k.paid_until)}</td>
                    <td className="mono small">{pagePrice(k)}</td>
                    <td className="small muted">{ago(k.last_seen_at)}</td>
                    <td><Link className="btn btn-sm" href={`/painel/quiosques/${k.id}`}>Abrir</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>Adicionar quiosque</h2>
        <p className="muted small">
          No aparelho, abra <b>Configurações › Assinatura</b> (pede o PIN do atendente) e copie o
          código da loja e o código de vinculação. O app precisa estar aberto e com internet.
        </p>
        <form action={addKiosk} className="inline">
          <div className="field">
            <label htmlFor="codigo">Código da loja</label>
            <input id="codigo" name="codigo" placeholder="ABCD-EFGH" required maxLength={12} className="mono" autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="vinculo">Código de vinculação</label>
            <input id="vinculo" name="vinculo" placeholder="ABC-DEF" required maxLength={8} className="mono" autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="nome">Nome</label>
            <input id="nome" name="nome" placeholder="Balcão da entrada" maxLength={60} />
          </div>
          <button className="btn btn-primary" type="submit">Adicionar</button>
        </form>
      </section>
    </Shell>
  );
}
