import { NextResponse } from "next/server";
import { one, sql } from "@/lib/db";
import { extendKiosk } from "@/lib/kiosks";
import { getAuthorizedPayment, getPreapproval } from "@/lib/mercadopago";

export const dynamic = "force-dynamic";

/**
 * Mercado Pago notifications for the monthly plans. Every event is re-read from the
 * Mercado Pago API before anything changes, so a forged notification can't unlock a kiosk.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const type = String(body?.type ?? body?.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
  const id = String(body?.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");

  try {
    if (type === "subscription_preapproval" && id) {
      await syncPreapproval(id);
    } else if (type === "subscription_authorized_payment" && id) {
      await recordAuthorizedPayment(id);
    }
  } catch (error) {
    console.error("mp webhook", type, id, error);
    return NextResponse.json({ ok: false }, { status: 500 }); // Mercado Pago retries later
  }
  return NextResponse.json({ ok: true });
}

async function syncPreapproval(preapprovalId: string) {
  const preapproval = await getPreapproval(preapprovalId);
  const subscriptionId = Number(preapproval.external_reference);
  if (!subscriptionId) return;
  await sql`update subscriptions set status = ${String(preapproval.status)}, mp_preapproval_id = ${preapprovalId},
              updated_at = now() where id = ${subscriptionId}`;
}

async function recordAuthorizedPayment(authorizedPaymentId: string) {
  const charge = await getAuthorizedPayment(authorizedPaymentId);
  const paymentStatus = String(charge?.payment?.status ?? charge?.status ?? "");
  const paymentId = String(charge?.payment?.id ?? authorizedPaymentId);
  const preapprovalId = String(charge?.preapproval_id ?? "");

  const subscription = await one`select id, kiosk_id, owner_id, plan, amount_cents from subscriptions
                                 where mp_preapproval_id = ${preapprovalId}`;
  if (!subscription) return;

  const already = await one`select id from payments where mp_payment_id = ${paymentId}`;
  if (already) return;

  const amountCents = Math.round(Number(charge?.transaction_amount ?? subscription.amount_cents / 100) * 100);
  await sql`insert into payments (subscription_id, kiosk_id, owner_id, amount_cents, status, mp_payment_id)
            values (${subscription.id}, ${subscription.kiosk_id}, ${subscription.owner_id}, ${amountCents},
                    ${paymentStatus === "approved" ? "approved" : paymentStatus || "unknown"}, ${paymentId})
            on conflict (mp_payment_id) do nothing`;

  if (paymentStatus === "approved") {
    await sql`update subscriptions set status = 'authorized', updated_at = now() where id = ${subscription.id}`;
    await sql`update kiosks set plan = ${subscription.plan} where id = ${subscription.kiosk_id}`;
    await extendKiosk(Number(subscription.kiosk_id), { months: 1, source: "payment" });
  }
}
