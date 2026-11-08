import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { one, sql } from "@/lib/db";
import { extendKiosk } from "@/lib/kiosks";
import { MercadoPagoError, getAuthorizedPayment, getPreapproval } from "@/lib/mercadopago";
import { audit, ipFromHeaders, rateLimit, safeEqual } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * Mercado Pago notifications for the monthly plans.
 *
 * Forged calls can't unlock a kiosk: every event is re-read from the Mercado Pago API with our
 * token before anything changes, and a month is only granted when the approved amount covers
 * the plan price. The x-signature check is optional and off by default; it runs only when
 * MERCADOPAGO_WEBHOOK_VERIFY=1 and MERCADOPAGO_WEBHOOK_SECRET are both set.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!(await rateLimit(`webhook:ip:${ipFromHeaders(request.headers)}`, 300, 60))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  const raw = await request.text();
  if (raw.length > 64 * 1024) return NextResponse.json({ ok: false }, { status: 413 });
  let body: any = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = {};
  }

  const type = String(body?.type ?? body?.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
  const id = String(body?.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "").slice(0, 64);

  if (!validSignature(request, url, id)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return NextResponse.json({ ok: true });

  try {
    if (type === "subscription_preapproval") {
      await syncPreapproval(id);
    } else if (type === "subscription_authorized_payment") {
      await recordAuthorizedPayment(id);
    }
  } catch (error) {
    // Unknown id (Mercado Pago's "Simular notificação" uses made-up ids): nothing to do.
    if (error instanceof MercadoPagoError && (error.status === 404 || error.status === 400)) {
      return NextResponse.json({ ok: true, ignored: true });
    }
    console.error("mp webhook", type, id, error);
    return NextResponse.json({ ok: false }, { status: 500 }); // Mercado Pago retries later
  }
  return NextResponse.json({ ok: true });
}

/** Mercado Pago's documented scheme: HMAC-SHA256 of "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". */
function validSignature(request: Request, url: URL, bodyId: string): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (process.env.MERCADOPAGO_WEBHOOK_VERIFY !== "1" || !secret) return true; // the API re-read below protects either way
  const header = request.headers.get("x-signature") ?? "";
  const parts = Object.fromEntries(
    header.split(",").map((part) => part.split("=").map((s) => s.trim()) as [string, string]),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  let dataId = url.searchParams.get("data.id") ?? bodyId;
  if (/^[a-z0-9]+$/i.test(dataId)) dataId = dataId.toLowerCase();
  const requestId = request.headers.get("x-request-id");
  let manifest = "";
  if (dataId) manifest += `id:${dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  return safeEqual(expected, v1);
}

async function syncPreapproval(preapprovalId: string) {
  const preapproval = await getPreapproval(preapprovalId);
  const subscriptionId = Number(preapproval.external_reference);
  if (!subscriptionId) return;
  // Only update the subscription this preapproval was created for.
  await sql`update subscriptions set status = ${String(preapproval.status).slice(0, 20)}, mp_preapproval_id = ${preapprovalId},
              updated_at = now()
            where id = ${subscriptionId} and (mp_preapproval_id is null or mp_preapproval_id = ${preapprovalId})`;
}

async function recordAuthorizedPayment(authorizedPaymentId: string) {
  const charge = await getAuthorizedPayment(authorizedPaymentId);
  const paymentStatus = String(charge?.payment?.status ?? charge?.status ?? "").slice(0, 20);
  const paymentId = String(charge?.payment?.id ?? authorizedPaymentId).slice(0, 64);
  const preapprovalId = String(charge?.preapproval_id ?? "");

  const subscription = await one`select id, kiosk_id, owner_id, plan, amount_cents from subscriptions
                                 where mp_preapproval_id = ${preapprovalId}`;
  if (!subscription) return;

  const already = await one`select id from payments where mp_payment_id = ${paymentId}`;
  if (already) return;

  const amountCents = Math.round(Number(charge?.transaction_amount ?? 0) * 100);
  const currency = String(charge?.currency_id ?? "BRL");
  const coversPlan = currency === "BRL" && amountCents >= Number(subscription.amount_cents);

  await sql`insert into payments (subscription_id, kiosk_id, owner_id, amount_cents, status, mp_payment_id)
            values (${subscription.id}, ${subscription.kiosk_id}, ${subscription.owner_id}, ${amountCents},
                    ${paymentStatus === "approved" ? "approved" : paymentStatus || "unknown"}, ${paymentId})
            on conflict (mp_payment_id) do nothing`;

  if (paymentStatus !== "approved") return;
  if (!coversPlan) {
    await audit(null, "webhook_valor_divergente", String(subscription.kiosk_id), `${currency} ${amountCents} centavos, pagamento ${paymentId}`);
    return;
  }
  await sql`update subscriptions set status = 'authorized', updated_at = now() where id = ${subscription.id}`;
  await sql`update kiosks set plan = ${subscription.plan} where id = ${subscription.kiosk_id}`;
  await extendKiosk(Number(subscription.kiosk_id), { months: 1, source: "payment" });
}
