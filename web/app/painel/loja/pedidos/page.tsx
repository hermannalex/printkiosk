import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { brl, dateTimeBR } from "@/lib/format";
import { ORDER_STATUS_LABEL, ORDER_STATUS_PILL, storeOfOwner } from "@/lib/store";
import { Flash, Kpi, Shell, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Pedidos online · imprime.ai" };
export const dynamic = "force-dynamic";

const FILTERS: [string, string, string[]][] = [
  ["abertos", "Para fazer", ["paid", "printing", "ready"]],
  ["entregues", "Entregues", ["delivered"]],
  ["cancelados", "Cancelados", ["cancelled"]],
  ["pix", "Pix em aberto ou expirado", ["awaiting_payment", "expired"]],
];

export default async function StoreOrders({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const store = await storeOfOwner(user.id);
  if (!store) {
    return (
      <Shell user={user} area="owner" current="/painel/loja/pedidos">
        <p className="card empty">Você ainda não tem loja online. <Link href="/painel/loja">Configurar</Link></p>
      </Shell>
    );
  }
  const filter = FILTERS.find((f) => f[0] === param(params, "ver")) ?? FILTERS[0];
  const orders = await sql`
    select o.code, o.status, o.total_cents, o.created_at, o.paid_at, c.name, c.email,
           (select count(*)::int from store_order_items i where i.order_id = o.id) as files
    from store_orders o left join store_customers c on c.id = o.customer_id
    where o.store_id = ${store.id} and o.status = any(${filter[2]}::text[])
    order by case when ${filter[0] === "abertos"}::boolean then coalesce(o.paid_at, o.created_at) end asc,
             coalesce(o.paid_at, o.created_at) desc
    limit 300`;
  const stats = await sql`
    select coalesce(sum(total_cents) filter (where paid_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo')), 0)::bigint as month,
           count(*) filter (where paid_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo'))::int as month_orders,
           count(distinct customer_id)::int as customers
    from store_orders where store_id = ${store.id} and paid_at is not null and status <> 'cancelled'`;

  return (
    <Shell user={user} area="owner" current="/painel/loja/pedidos">
      <div className="page-head">
        <div>
          <h1>Pedidos online</h1>
          <p>Pedidos pagos por Pix na sua loja online. Abra para ver e baixar os arquivos.</p>
        </div>
        <Link className="btn" href="/painel/loja">Configurar loja</Link>
      </div>
      <Flash msg={param(params, "msg")} erro={param(params, "erro")} />
      <section className="kpis">
        <Kpi label="Recebido no mês" value={brl(stats[0]?.month ?? 0)} foot={`${stats[0]?.month_orders ?? 0} pedidos pagos`} />
        <Kpi label="Clientes" value={String(stats[0]?.customers ?? 0)} foot="já pagaram algum pedido" />
      </section>
      <nav className="tabs" aria-label="Filtro">
        {FILTERS.map(([key, label]) => (
          <Link key={key} href={`/painel/loja/pedidos?ver=${key}`} aria-current={filter[0] === key ? "page" : undefined}>{label}</Link>
        ))}
      </nav>
      <section className="card">
        {orders.length === 0 ? <p className="empty">Nenhum pedido aqui.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pedido</th><th>Cliente</th><th>{filter[0] === "pix" ? "Criado" : "Pago"}</th><th className="num">Arquivos</th><th className="num">Total</th><th>Situação</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.code}>
                    <td className="mono"><Link href={`/painel/loja/pedidos/${o.code}`}>{o.code}</Link></td>
                    <td>{o.name ?? "—"}<br /><span className="small muted">{o.email}</span></td>
                    <td>{dateTimeBR(o.paid_at ?? o.created_at)}</td>
                    <td className="num">{o.files}</td>
                    <td className="num">{brl(o.total_cents)}</td>
                    <td><span className={`pill ${ORDER_STATUS_PILL[o.status] ?? ""}`}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}
