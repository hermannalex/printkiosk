import { one } from "@/lib/db";
import { ipFromHeaders, rateLimit } from "@/lib/security";
import { syncOrderPayment } from "@/lib/store-pix";

export const dynamic = "force-dynamic";

/**
 * Mercado Pago tells us a payment of a store changed (?store=<id>). Nothing in the call is trusted:
 * the order is found by the payment id we saved, and its status is read back from Mercado Pago
 * with the store's own token.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const storeId = Number(url.searchParams.get("store"));
  const body = await request.json().catch(() => ({}));
  const paymentId = String(body?.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");
  if (!(await rateLimit(`loja-webhook:${ipFromHeaders(request.headers)}`, 600, 600))) return new Response("slow down", { status: 429 });
  if (Number.isSafeInteger(storeId) && storeId > 0 && /^\d{1,20}$/.test(paymentId)) {
    const order = await one`select id from store_orders where store_id = ${storeId} and mp_payment_id = ${paymentId}`;
    if (order) await syncOrderPayment(Number(order.id));
  }
  return Response.json({ ok: true });
}
