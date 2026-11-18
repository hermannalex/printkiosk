import { one, sql } from "@/lib/db";
import { audit, rateLimit } from "@/lib/security";
import { cleanupStores, fileSignatureValid, newOrderCode, openStore, validStorePathname, type CheckedFile } from "@/lib/store";
import { currentCustomer } from "@/lib/store-auth";
import { createOrderPix } from "@/lib/store-pix";
import { MAX_COPIES, MAX_ORDER_CENTS, MAX_ORDER_FILES, priceItem } from "@/lib/store-price";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const fail = (error: string, status = 400) => Response.json({ error }, { status });

/** Creates the order with the prices computed here, then the Pix in the store's Mercado Pago. */
export async function POST(request: Request) {
  const input = await request.json().catch(() => ({}));
  const store = await openStore(String(input?.slug ?? ""));
  if (!store) return fail("Esta loja não está recebendo pedidos agora.", 404);
  const customer = await currentCustomer(store.id);
  if (!customer) return fail("Entre de novo para continuar.", 401);
  if (!(await rateLimit(`loja-pedido:${customer.id}`, 20, 3600))) return fail("Muitos pedidos seguidos. Aguarde alguns minutos.", 429);

  const raw = Array.isArray(input?.items) ? input.items : [];
  if (raw.length < 1) return fail("Envie pelo menos um arquivo.");
  if (raw.length > MAX_ORDER_FILES) return fail(`Até ${MAX_ORDER_FILES} arquivos por pedido.`);

  const items: (CheckedFile & { paper: string; color: boolean; copies: number; extras: string[]; cents: number })[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const file: CheckedFile = {
      pathname: String(r?.pathname ?? ""),
      name: String(r?.name ?? ""),
      kind: r?.kind === "pdf" ? "pdf" : "image",
      size: Number(r?.size),
      pages: Number(r?.pages),
    };
    if (!validStorePathname(store.id, customer.id, file.pathname) || seen.has(file.pathname) ||
        !fileSignatureValid(store.id, customer.id, file, String(r?.token ?? ""))) {
      return fail("Um dos arquivos precisa ser enviado de novo.");
    }
    seen.add(file.pathname);
    const choice = {
      pages: file.pages,
      paper: String(r?.paper ?? ""),
      color: r?.color === true,
      copies: Math.floor(Number(r?.copies)),
      extras: Array.isArray(r?.extras) ? r.extras.map(String).slice(0, 20) : [],
    };
    if (!(choice.copies >= 1 && choice.copies <= MAX_COPIES)) return fail(`Escolha de 1 a ${MAX_COPIES} cópias.`);
    const price = priceItem(store.config, choice);
    if ("error" in price) return fail(`${file.name}: ${price.error}`);
    items.push({ ...file, ...choice, cents: price.cents });
  }
  const total = items.reduce((sum, i) => sum + i.cents, 0);
  if (total < 1) return fail("O valor do pedido é zero. Fale com a loja.");
  if (total > MAX_ORDER_CENTS) return fail("Pedido acima de R$ 5.000,00. Divida em pedidos menores.");
  if (Number(input?.total) !== total) return fail("Os preços mudaram. Confira o novo total e tente de novo.", 409);

  const used = await sql`select 1 from store_order_items where pathname = any(${[...seen]}::text[]) limit 1`;
  if (used.length) return fail("Um dos arquivos já está em outro pedido. Envie de novo.");

  const note = String(input?.note ?? "").replace(/[\u0000-\u0008\u000b-\u001f<>]/g, "").trim().slice(0, 300);
  let order: { id: number; code: string } | null = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    const row = await one`
      insert into store_orders (store_id, customer_id, code, total_cents, note)
      values (${store.id}, ${customer.id}, ${newOrderCode()}, ${total}, ${note})
      on conflict (code) do nothing returning id, code`;
    if (row) order = { id: Number(row.id), code: row.code };
  }
  if (!order) return fail("Tente de novo.", 500);
  for (const i of items) {
    await sql`insert into store_order_items (order_id, pathname, file_name, kind, size_bytes, pages, paper, color, copies, extras, total_cents)
              values (${order.id}, ${i.pathname}, ${i.name.slice(0, 120)}, ${i.kind}, ${i.size}, ${i.pages}, ${i.paper}, ${i.color},
                      ${i.copies}, ${JSON.stringify(i.extras)}::jsonb, ${i.cents})`;
  }

  try {
    await createOrderPix({ id: order.id, code: order.code, storeId: store.id, totalCents: total }, customer, store.name);
  } catch (error) {
    console.error("store pix", order.id, error);
    await sql`update store_orders set status = 'expired', updated_at = now() where id = ${order.id}`;
    await audit(store.ownerId, "loja_pix_falhou", order.code, error instanceof Error ? error.message.slice(0, 300) : null);
    return fail("Não foi possível gerar o Pix agora. A loja foi avisada; tente de novo em instantes.", 502);
  }

  if (Math.random() < 0.1) cleanupStores().catch((e) => console.error("store cleanup", e));
  return Response.json({ code: order.code });
}
