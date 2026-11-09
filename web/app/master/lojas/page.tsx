import { masterToggleBlock } from "../../actions";
import { masterResetMfa } from "../../mfa-actions";
import { requireMaster } from "@/lib/auth";
import { sql } from "@/lib/db";
import { brl, dateBR, num, todayIso } from "@/lib/format";
import { Flash, Shell, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Lojas · Master · imprime.ai" };
export const dynamic = "force-dynamic";

export default async function MasterStores({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireMaster();
  const params = await searchParams;
  const today = todayIso();
  const owners = await sql`
    select u.id, u.name, u.email, u.phone, u.role, u.blocked, u.created_at, u.totp_enabled,
           count(k.id)::int as kiosks,
           (count(k.id) filter (where k.paid_until >= ${today}))::int as paying,
           (count(k.id) filter (where k.paid_until >= ${today} and k.plan = 'pro'))::int as pro,
           coalesce((select sum(amount_cents) from subscriptions s where s.owner_id = u.id and s.status = 'authorized'), 0)::bigint as mrr
    from users u left join kiosks k on k.owner_id = u.id
    group by u.id order by u.created_at desc`;

  return (
    <Shell user={user} area="master" current="/master/lojas">
      <div className="page-head">
        <div>
          <h1>Lojas</h1>
          <p>{owners.length} contas.</p>
        </div>
      </div>
      <Flash msg={param(params, "msg")} erro={param(params, "erro")} />
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Loja</th><th>Contato</th><th className="num">Quiosques</th><th className="num">Pagantes</th>
                <th className="num">Pro</th><th className="num">MRR</th><th>2 etapas</th><th>Desde</th><th></th>
              </tr>
            </thead>
            <tbody>
              {owners.map((o) => (
                <tr key={o.id}>
                  <td>
                    {o.name} {o.role === "master" && <span className="pill pill-pro">Master</span>}
                    {o.blocked && <span className="pill pill-expired">Bloqueada</span>}
                  </td>
                  <td className="small">{o.email}{o.phone && <> · {o.phone}</>}</td>
                  <td className="num">{num(o.kiosks)}</td>
                  <td className="num">{num(o.paying)}</td>
                  <td className="num">{num(o.pro)}</td>
                  <td className="num">{brl(o.mrr)}</td>
                  <td>
                    {o.totp_enabled ? <span className="pill pill-active">Ativa</span> : <span className="pill pill-demo">Pendente</span>}
                  </td>
                  <td className="mono small">{dateBR(o.created_at)}</td>
                  <td className="inline-actions">
                    {o.totp_enabled && Number(o.id) !== user.id && (
                      <form action={masterResetMfa}>
                        <input type="hidden" name="id" value={o.id} />
                        <button className="btn btn-sm" type="submit">Redefinir 2 etapas</button>
                      </form>
                    )}
                    {o.role !== "master" && (
                      <form action={masterToggleBlock}>
                        <input type="hidden" name="id" value={o.id} />
                        <button className={`btn btn-sm ${o.blocked ? "" : "btn-danger"}`} type="submit">
                          {o.blocked ? "Desbloquear" : "Bloquear"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}
