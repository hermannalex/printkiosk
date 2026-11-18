import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { brl, dateTimeBR } from "@/lib/format";
import { ORDER_STATUS_LABEL, ORDER_STATUS_PILL, openStore } from "@/lib/store";
import { currentCustomer } from "@/lib/store-auth";

export default async function MyOrders({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await openStore(slug);
  if (!store) notFound();
  const customer = await currentCustomer(store.id);
  if (!customer) redirect(`/loja/${store.slug}/entrar?next=${encodeURIComponent(`/loja/${store.slug}/pedidos`)}`);
  const orders = await sql`
    select o.code, o.status, o.total_cents, o.created_at, (select count(*)::int from store_order_items i where i.order_id = o.id) as files
    from store_orders o where o.store_id = ${store.id} and o.customer_id = ${customer!.id}
    order by o.created_at desc limit 100`;
  return (
    <>
      <div className="page-head">
        <div><h1>Meus pedidos</h1></div>
        <Link className="btn btn-primary" href={`/loja/${store.slug}/pedido/novo`}>Novo pedido</Link>
      </div>
      <section className="card">
        {orders.length === 0 ? <p className="empty">Você ainda não fez pedidos nesta loja.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pedido</th><th>Data</th><th className="num">Arquivos</th><th className="num">Total</th><th>Situação</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.code}>
                    <td className="mono"><Link href={`/loja/${store.slug}/pedido/${o.code}`}>{o.code}</Link></td>
                    <td>{dateTimeBR(o.created_at)}</td>
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
    </>
  );
}
