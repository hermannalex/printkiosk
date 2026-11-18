import Link from "next/link";
import { notFound } from "next/navigation";
import { setOrderStatus } from "../../../../store-actions";
import { requireUser } from "@/lib/auth";
import { one, sql } from "@/lib/db";
import { brl, dateTimeBR } from "@/lib/format";
import { ORDER_STATUS_LABEL, ORDER_STATUS_PILL, isOrderCode, storeOfOwner } from "@/lib/store";
import { Flash, Shell, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Pedido online · imprime.ai" };
export const dynamic = "force-dynamic";

const ACTIONS: Record<string, [string, string, string][]> = {
  paid: [["printing", "Começar a imprimir", "btn-primary"], ["ready", "Marcar como pronto", ""], ["cancelled", "Cancelar", "btn-danger"]],
  printing: [["ready", "Marcar como pronto", "btn-primary"], ["cancelled", "Cancelar", "btn-danger"]],
  ready: [["delivered", "Entregue ao cliente", "btn-primary"], ["printing", "Voltar para imprimindo", ""]],
  delivered: [["ready", "Desfazer entrega", ""]],
};

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function StoreOrder({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: SearchParams }) {
  const user = await requireUser();
  const { code } = await params;
  const query = await searchParams;
  const store = await storeOfOwner(user.id);
  if (!store || !isOrderCode(code)) notFound();
  const order = await one`
    select o.*, c.name, c.email from store_orders o left join store_customers c on c.id = o.customer_id
    where o.code = ${code} and o.store_id = ${store!.id}`;
  if (!order) notFound();
  const items = await sql`select * from store_order_items where order_id = ${order.id} order by id`;
  const sizeName = (id: string) => store!.config.sizes.find((s) => s.id === id)?.name ?? id;
  const extraName = (id: string) => store!.config.extras.find((e) => e.id === id)?.name ?? id;
  const filesOpen = !["awaiting_payment", "expired"].includes(order.status) && !order.files_deleted_at;
  const sheets = items.reduce((n, i) => n + Number(i.pages) * Number(i.copies), 0);

  return (
    <Shell user={user} area="owner" current="/painel/loja/pedidos">
      <div className="page-head">
        <div>
          <p className="small"><Link href="/painel/loja/pedidos">← Pedidos</Link></p>
          <h1>Pedido <span className="mono">{order.code}</span></h1>
          <p>{order.name ?? "Cliente"} · {order.email} · {order.paid_at ? `pago em ${dateTimeBR(order.paid_at)}` : `criado em ${dateTimeBR(order.created_at)}`}</p>
        </div>
        <span className={`pill ${ORDER_STATUS_PILL[order.status] ?? ""}`}>{ORDER_STATUS_LABEL[order.status] ?? order.status}</span>
      </div>
      <Flash msg={param(query, "msg")} erro={param(query, "erro")} />

      {(ACTIONS[order.status] ?? []).length > 0 && (
        <section className="card inline-actions">
          {ACTIONS[order.status].map(([status, label, style]) => (
            <form key={status} action={setOrderStatus}>
              <input type="hidden" name="pedido" value={order.code} />
              <input type="hidden" name="status" value={status} />
              <button className={`btn ${style}`} type="submit">{label}</button>
            </form>
          ))}
        </section>
      )}

      {order.note && <p className="notice notice-ok pre-line">Observação do cliente: {order.note}</p>}
      {!filesOpen && (
        <p className="notice notice-err">
          {order.files_deleted_at ? "Os arquivos deste pedido já foram apagados (ficam guardados 7 dias depois de entregue ou cancelado)."
            : "Os arquivos aparecem aqui quando o Pix for pago."}
        </p>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Arquivos para imprimir</h2>
          <span className="muted small">{items.length} arquivo(s) · {sheets} página(s) impressas · <b>{brl(order.total_cents)}</b></span>
        </div>
        <div className="order-files">
          {items.map((i) => (
            <article key={i.id} className="order-file-row">
              {filesOpen && i.kind === "image" && !/\.(heic|heif)$/i.test(i.file_name) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="thumb" src={`/api/painel/loja/arquivo?item=${i.id}`} alt="" loading="lazy" />
              ) : (
                <span className="thumb thumb-badge">{i.kind === "pdf" ? "PDF" : "FOTO"}</span>
              )}
              <div className="order-file-info">
                <b className="file-name">{i.file_name}</b>
                <span className="small muted">
                  {i.pages} {Number(i.pages) === 1 ? "página" : "páginas"} · {sizeLabel(Number(i.size_bytes))}
                </span>
                <span className="print-spec">
                  <b>{i.copies} {Number(i.copies) === 1 ? "cópia" : "cópias"}</b> · {sizeName(i.paper)} · {i.color ? "Colorido" : "Preto e branco"}
                  {(i.extras as string[]).length > 0 && <> · {(i.extras as string[]).map(extraName).join(", ")}</>}
                </span>
              </div>
              <span className="num">{brl(i.total_cents)}</span>
              {filesOpen && (
                <div className="inline-actions">
                  <a className="btn btn-sm" href={`/api/painel/loja/arquivo?item=${i.id}`} target="_blank" rel="noopener">Ver</a>
                  <a className="btn btn-sm btn-primary" href={`/api/painel/loja/arquivo?item=${i.id}&baixar=1`}>Baixar</a>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
      {order.mp_payment_id && <p className="small muted">Pagamento no Mercado Pago: <span className="mono">{order.mp_payment_id}</span></p>}
    </Shell>
  );
}
