import { randomUUID } from "node:crypto";
import { one, sql } from "./db";
import { emailConfigured, sendEmail } from "./email";
import { brl } from "./format";
import { PAY_MINUTES, PUBLIC_URL, storeById, storeToken } from "./store";

/**
 * Pix with the STORE's own Mercado Pago token (never imprime.ai's): the money goes straight to the
 * store. The order page asks for the status every few seconds and the webhook does the same; both
 * always read the payment back from Mercado Pago before trusting it.
 */

const API = "https://api.mercadopago.com";

export const cleanToken = (token: string) => token.replace(/\s+/g, "").replace(/^Bearer/i, "");

export async function mp(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.message || body?.error || `erro ${response.status}`;
    const error = new Error(`Mercado Pago: ${detail}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body;
}

/** Checks a token the store pasted: returns the account's name, or throws with the reason. */
export async function checkStoreToken(token: string): Promise<string> {
  const me = await mp(cleanToken(token), "/users/me");
  return String(me?.nickname || me?.email || me?.id || "conta Mercado Pago");
}

/** "2026-11-18T14:30:00.000-03:00": the format Mercado Pago expects for date_of_expiration. */
export function brasiliaIso(date: Date): string {
  const local = new Date(date.getTime() - 3 * 3_600_000);
  return local.toISOString().replace("Z", "-03:00");
}

export async function createOrderPix(order: { id: number; code: string; storeId: number; totalCents: number },
                                     customer: { name: string; email: string }, storeName: string) {
  const token = await storeToken(order.storeId);
  if (!token) throw new Error("A loja ainda não configurou o recebimento por Pix.");
  const expires = new Date(Date.now() + PAY_MINUTES * 60_000);
  const [first, ...rest] = customer.name.split(/\s+/);
  const payment = await mp(token, "/v1/payments", {
    method: "POST",
    headers: { "X-Idempotency-Key": `imprime-order-${order.id}-${randomUUID()}` },
    body: JSON.stringify({
      transaction_amount: order.totalCents / 100,
      payment_method_id: "pix",
      description: `Impressão ${order.code} · ${storeName}`.slice(0, 120),
      external_reference: `imprime-loja-${order.id}`,
      notification_url: `${PUBLIC_URL}/api/loja/webhook?store=${order.storeId}`,
      date_of_expiration: brasiliaIso(expires),
      payer: { email: customer.email, first_name: first || customer.name, last_name: rest.join(" ") || undefined },
    }),
  });
  const data = payment?.point_of_interaction?.transaction_data ?? {};
  if (!payment?.id || !data.qr_code) throw new Error("O Mercado Pago não gerou o Pix. Confira se a conta da loja tem uma chave Pix.");
  await sql`update store_orders
            set mp_payment_id = ${String(payment.id)}, pix_qr = ${data.qr_code}, pix_qr_base64 = ${data.qr_code_base64 ?? null},
                pay_expires_at = ${expires.toISOString()}, updated_at = now()
            where id = ${order.id}`;
}

/**
 * Reads the order's payment from Mercado Pago and moves the order on: approved → paid (and the
 * store is told by e-mail), cancelled/rejected/expired → expired. Returns the order's status.
 */
export async function syncOrderPayment(orderId: number): Promise<string> {
  const order = await one`select id, store_id, code, status, total_cents, mp_payment_id, pay_expires_at from store_orders where id = ${orderId}`;
  if (!order) return "missing";
  if (order.status !== "awaiting_payment") return order.status;
  if (order.mp_payment_id) {
    const token = await storeToken(Number(order.store_id));
    if (token) {
      try {
        const payment = await mp(token, `/v1/payments/${encodeURIComponent(order.mp_payment_id)}`);
        const amountOk = Math.round(Number(payment?.transaction_amount) * 100) === Number(order.total_cents);
        const refOk = payment?.external_reference === `imprime-loja-${order.id}`;
        if (payment?.status === "approved" && amountOk && refOk) {
          const updated = await sql`update store_orders set status = 'paid', paid_at = now(), updated_at = now()
                                    where id = ${order.id} and status = 'awaiting_payment' returning id`;
          if (updated.length) await notifyPaid(order.id);
          return "paid";
        }
        if (["cancelled", "rejected", "refunded", "charged_back"].includes(payment?.status)) {
          await sql`update store_orders set status = 'expired', updated_at = now() where id = ${order.id} and status = 'awaiting_payment'`;
          return "expired";
        }
      } catch (error) {
        console.error("store payment sync", order.id, error);
      }
    }
  }
  if (order.pay_expires_at && new Date(order.pay_expires_at).getTime() < Date.now() - 5 * 60_000) {
    await sql`update store_orders set status = 'expired', updated_at = now() where id = ${order.id} and status = 'awaiting_payment'`;
    return "expired";
  }
  return "awaiting_payment";
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function simpleEmail(title: string, lines: string[], link: { href: string; label: string }) {
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;color:#16202c">
<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
${lines.map((l) => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`).join("\n")}
<p style="margin:20px 0"><a href="${link.href}" style="background:#4F46E5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(link.label)}</a></p>
<p style="color:#5b6573;font-size:12px">imprime.ai</p></div>`;
  return { html, text: `${title}\n\n${lines.join("\n")}\n\n${link.label}: ${link.href}` };
}

/** E-mail to the store: a new paid order is waiting to be printed. */
async function notifyPaid(orderId: number) {
  if (!emailConfigured()) return;
  try {
    const row = await one`
      select o.code, o.total_cents, o.store_id, c.name as customer, u.email as owner_email,
             (select count(*)::int from store_order_items i where i.order_id = o.id) as files
      from store_orders o join stores s on s.id = o.store_id join users u on u.id = s.owner_id
      left join store_customers c on c.id = o.customer_id
      where o.id = ${orderId}`;
    if (!row) return;
    const store = await storeById(Number(row.store_id));
    const to = store?.notifyEmail || row.owner_email;
    const body = simpleEmail(
      `Novo pedido pago: ${row.code}`,
      [`${row.customer ?? "Cliente"} pagou ${brl(row.total_cents)} por ${row.files} arquivo(s).`, "Abra o pedido no painel para ver e baixar os arquivos."],
      { href: `${PUBLIC_URL}/painel/loja/pedidos/${row.code}`, label: "Abrir pedido" },
    );
    await sendEmail({ to, subject: `Novo pedido ${row.code} · ${brl(row.total_cents)}`, ...body, idempotencyKey: `loja-pago-${orderId}` });
  } catch (error) {
    console.error("store paid e-mail", orderId, error);
  }
}

/** E-mail to the customer: the order is ready to pick up. */
export async function notifyReady(orderId: number) {
  if (!emailConfigured()) return;
  try {
    const row = await one`
      select o.code, s.name as store, s.slug, s.pickup_info, c.name, c.email
      from store_orders o join stores s on s.id = o.store_id join store_customers c on c.id = o.customer_id
      where o.id = ${orderId}`;
    if (!row) return;
    const lines = [`Olá, ${String(row.name).split(/\s+/)[0]}! Seu pedido ${row.code} na ${row.store} está pronto para retirar.`];
    if (row.pickup_info) lines.push(row.pickup_info);
    const body = simpleEmail(`Pedido ${row.code} pronto`, lines, { href: `${PUBLIC_URL}/loja/${row.slug}/pedido/${row.code}`, label: "Ver pedido" });
    await sendEmail({ to: row.email, subject: `Seu pedido ${row.code} está pronto`, ...body, idempotencyKey: `loja-pronto-${orderId}` });
  } catch (error) {
    console.error("store ready e-mail", orderId, error);
  }
}
