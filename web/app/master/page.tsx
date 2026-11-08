import Link from "next/link";
import { requireMaster } from "@/lib/auth";
import { one, sql } from "@/lib/db";
import { brl, dateBR, num, todayIso } from "@/lib/format";
import { Flash, Kpi, PlanPill, Shell, param, type SearchParams } from "@/components/ui";
import { PERIODS, PeriodPicker, StatsView } from "@/components/stats-view";

export const metadata = { title: "Master · Quioco" };
export const dynamic = "force-dynamic";

export default async function MasterOverview({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireMaster();
  const params = await searchParams;
  const days = PERIODS.includes(Number(param(params, "dias"))) ? Number(param(params, "dias")) : 30;
  const today = todayIso();

  const [business, monthPayments, expiring] = await Promise.all([
    one`select
          (select coalesce(sum(amount_cents), 0) from subscriptions where status = 'authorized')::bigint as mrr,
          (select count(*) from subscriptions where status = 'authorized')::int as subs,
          (select count(*) from kiosks)::int as kiosks,
          (select count(*) from kiosks where paid_until >= ${today})::int as paying,
          (select count(*) from kiosks where paid_until >= ${today} and plan = 'pro')::int as pro,
          (select count(*) from kiosks where paid_until is null and last_seen_at is not null)::int as demo,
          (select count(*) from kiosks where last_seen_at > now() - interval '24 hours')::int as online,
          (select count(*) from users where role = 'owner')::int as owners`,
    one`select coalesce(sum(amount_cents), 0)::bigint as total, count(*)::int as count
        from payments where status in ('approved', 'manual')
          and paid_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'`,
    sql`select k.id, k.name, k.store_code, k.plan, k.paid_until, u.name as owner_name
        from kiosks k left join users u on u.id = k.owner_id
        where k.paid_until between ${today}::date and ${today}::date + 7
        order by k.paid_until limit 10`,
  ]);

  return (
    <Shell user={user} area="master" current="/master">
      <div className="page-head">
        <div>
          <h1>Painel master</h1>
          <p>Assinaturas, quiosques e movimento de todas as lojas.</p>
        </div>
        <PeriodPicker days={days} basePath="/master" />
      </div>
      <Flash msg={param(params, "msg")} erro={param(params, "erro")} />

      <section className="kpis" aria-label="Negócio">
        <Kpi label="Receita recorrente (MRR)" value={brl(business?.mrr)} foot={`${num(business?.subs)} assinaturas ativas`} />
        <Kpi label="Recebido no mês" value={brl(monthPayments?.total)} foot={`${num(monthPayments?.count)} pagamentos`} />
        <Kpi label="Quiosques pagantes" value={num(business?.paying)} foot={`${num(business?.pro)} no Pro · ${num(business?.kiosks)} no total`} />
        <Kpi label="Em demonstração" value={num(business?.demo)} foot={`${num(business?.online)} online nas últimas 24 h`} />
        <Kpi label="Lojas cadastradas" value={num(business?.owners)} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Vencem nos próximos 7 dias</h2>
          <Link href="/master/quiosques" className="small">Ver todos os quiosques</Link>
        </div>
        {expiring.length === 0 ? (
          <p className="empty">Nenhum quiosque vence nesta semana.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Quiosque</th><th>Loja</th><th>Plano</th><th>Vence em</th></tr></thead>
              <tbody>
                {expiring.map((k) => (
                  <tr key={k.id}>
                    <td><Link href={`/master/quiosques/${k.id}`}>{k.name}</Link> <span className="mono small muted">{k.store_code}</span></td>
                    <td>{k.owner_name ?? "—"}</td>
                    <td><PlanPill plan={k.plan} /></td>
                    <td className="mono">{dateBR(k.paid_until)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <h2>Movimento de todos os quiosques</h2>
      <StatsView scope={null} days={days} kioskLink={(id) => `/master/quiosques/${id}`} />
    </Shell>
  );
}
