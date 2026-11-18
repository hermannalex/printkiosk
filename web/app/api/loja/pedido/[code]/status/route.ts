import { one } from "@/lib/db";
import { isOrderCode } from "@/lib/store";
import { currentCustomer } from "@/lib/store-auth";
import { syncOrderPayment } from "@/lib/store-pix";

export const dynamic = "force-dynamic";

/** The order page asks this every few seconds while the Pix is open. */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isOrderCode(code)) return Response.json({ error: "not found" }, { status: 404 });
  const order = await one`select id, store_id, customer_id, status from store_orders where code = ${code}`;
  if (!order) return Response.json({ error: "not found" }, { status: 404 });
  const customer = await currentCustomer(Number(order.store_id));
  if (!customer || customer.id !== Number(order.customer_id)) return Response.json({ error: "not found" }, { status: 404 });
  const status = order.status === "awaiting_payment" ? await syncOrderPayment(Number(order.id)) : order.status;
  return Response.json({ status }, { headers: { "Cache-Control": "no-store" } });
}
