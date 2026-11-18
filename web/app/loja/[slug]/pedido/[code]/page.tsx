import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import StatusWatcher from "./status-watcher";
import { CopyButton } from "@/components/copy-button";
import { one, sql } from "@/lib/db";
import { brl, dateTimeBR } from "@/lib/format";
import { ORDER_STATUS_LABEL, ORDER_STATUS_PILL, isOrderCode, openStore } from "@/lib/store";
import { currentCustomer } from "@/lib/store-auth";

export default async function OrderPage({ params }: { params: Promise<{ slug: string; code: string }> }) {
  const { slug, code } = await params;
  const store = await openStore(slug);
  if (!store || !isOrderCode(code)) notFound();
  const customer = await currentCustomer(store.id);
  const self = `/loja/${store.slug}/pedido/${code}`;
  if (!customer) redirect(`/loja/${store.slug}/entrar?next=${encodeURIComponent(self)}`);
  const order = await one`select * from store_orders where code = ${code} and store_id = ${store.id} and customer_id = ${customer!.id}`;
  if (!order) notFound();
  const items = await sql`select file_name, kind, pages, paper, color, copies, extras, total_cents from store_order_items where order_id = ${order.id} order by id`;
  const sizeName = (id: string) => store.config.sizes.find((s) => s.id === id)?.name ?? id;
  const extraName = (id: string) => store.config.extras.find((e) => e.id === id)?.name ?? id;
  const waiting = order.status === "awaiting_payment";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pedido <span className="mono">{order.code}</span></h1>
          <p>Feito em {dateTimeBR(order.created_at)}</p>
        </div>
        <span className={`pill ${ORDER_STATUS_PILL[order.status] ?? ""}`}>{ORDER_STATUS_LABEL[order.status] ?? order.status}</span>
      </div>

      {waiting && order.pix_qr && (
        <section className="card pix-card">
          <div>
            <h2>Pague {brl(order.total_cents)} por Pix</h2>
            <p className="muted">Abra o app do seu banco, escolha Pix e leia o QR Code ou use o Pix copia e cola. Vale até {dateTimeBR(order.pay_expires_at)}.</p>
          </div>
          {order.pix_qr_base64 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="pix-qr" src={`data:image/png;base64,${order.pix_qr_base64}`} alt="QR Code do Pix" width={220} height={220} />
          )}
          <div className="code-box">{order.pix_qr}</div>
          <div className="inline-actions"><CopyButton text={order.pix_qr} label="Copiar Pix copia e cola" /></div>
          <StatusWatcher code={order.code} />
        </section>
      )}

      {order.status === "paid" && <p className="notice notice-ok">Pagamento confirmado. A loja já recebeu seus arquivos e vai avisar por e-mail quando estiver pronto.</p>}
      {order.status === "printing" && <p className="notice notice-ok">A loja está imprimindo seu pedido.</p>}
      {order.status === "ready" && (
        <div className="notice notice-ok">
          Pronto para retirar! Mostre o código <b className="mono">{order.code}</b> no balcão.
          {store.pickupInfo && <p className="pre-line small">{store.pickupInfo}</p>}
        </div>
      )}
      {order.status === "expired" && (
        <p className="notice notice-err">O Pix deste pedido expirou sem pagamento. <Link href={`/loja/${store.slug}/pedido/novo`}>Fazer um novo pedido</Link></p>
      )}
      {order.status === "cancelled" && <p className="notice notice-err">Este pedido foi cancelado pela loja. Em caso de dúvida, fale com a loja.</p>}

      <section className="card">
        <div className="card-head"><h2>Arquivos</h2><b className="num">{brl(order.total_cents)}</b></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Arquivo</th><th>Impressão</th><th className="num">Cópias</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {items.map((i, n) => (
                <tr key={n}>
                  <td className="wrap">{i.file_name}<br /><span className="small muted">{i.pages} {i.pages === 1 ? "página" : "páginas"}</span></td>
                  <td className="wrap">
                    {sizeName(i.paper)} · {i.color ? "Colorido" : "Preto e branco"}
                    {(i.extras as string[]).length > 0 && <><br /><span className="small muted">{(i.extras as string[]).map(extraName).join(", ")}</span></>}
                  </td>
                  <td className="num">{i.copies}</td>
                  <td className="num">{brl(i.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {order.note && <p className="small muted pre-line" style={{ marginTop: 24 }}>Observação: {order.note}</p>}
      </section>
      <p><Link href={`/loja/${store.slug}/pedidos`}>Ver todos os meus pedidos</Link></p>
    </>
  );
}
