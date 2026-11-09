import Link from "next/link";
import { requireMaster } from "@/lib/auth";
import { sql } from "@/lib/db";
import { ago, dateBR } from "@/lib/format";
import { kioskStatus } from "@/lib/kiosks";
import { Flash, PlanPill, Shell, StatusPill, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Quiosques · Master · imprime.ai" };
export const dynamic = "force-dynamic";

export default async function MasterKiosks({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireMaster();
  const params = await searchParams;
  const q = (param(params, "q") ?? "").trim();
  const like = `%${q}%`;
  const kiosks = await sql`
    select k.*, u.name as owner_name, u.email as owner_email,
           (select count(*) from print_jobs j where j.kiosk_id = k.id and j.success
              and j.printed_at > now() - interval '30 days')::int as jobs30
    from kiosks k left join users u on u.id = k.owner_id
    where ${q} = '' or k.store_code ilike ${like} or k.name ilike ${like} or u.name ilike ${like} or u.email ilike ${like}
    order by k.last_seen_at desc nulls last, k.created_at desc
    limit 300`;

  return (
    <Shell user={user} area="master" current="/master/quiosques">
      <div className="page-head">
        <div>
          <h1>Quiosques</h1>
          <p>{kiosks.length} quiosques{q && ` encontrados para “${q}”`}.</p>
        </div>
        <form className="inline" action="/master/quiosques">
          <input name="q" defaultValue={q} placeholder="Código, nome, loja ou e-mail" aria-label="Buscar" />
          <button className="btn" type="submit">Buscar</button>
        </form>
      </div>
      <Flash msg={param(params, "msg")} erro={param(params, "erro")} />
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quiosque</th><th>Loja</th><th>Plano</th><th>Situação</th><th>Válido até</th>
                <th className="num">Impressões 30 d</th><th>Aparelho</th><th>Última conexão</th>
              </tr>
            </thead>
            <tbody>
              {kiosks.map((k) => (
                <tr key={k.id}>
                  <td><Link href={`/master/quiosques/${k.id}`}>{k.name}</Link> <span className="mono small muted">{k.store_code}</span></td>
                  <td>{k.owner_name ?? <span className="muted">sem dono</span>}</td>
                  <td><PlanPill plan={k.plan} /></td>
                  <td><StatusPill status={kioskStatus(k)} /></td>
                  <td className="mono">{dateBR(k.paid_until)}</td>
                  <td className="num">{k.jobs30}</td>
                  <td className="small muted">{[k.platform, k.app_version].filter(Boolean).join(" ") || "—"}</td>
                  <td className="small muted">{ago(k.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}
