/** Mercado Pago subscriptions (Assinaturas / preapproval) for the monthly plans. */

const API = "https://api.mercadopago.com";

export function mercadoPagoConfigured(): boolean {
  return !!process.env.MERCADOPAGO_ACCESS_TOKEN;
}

export class MercadoPagoError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call(path: string, init: RequestInit = {}): Promise<any> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error("O Mercado Pago ainda não foi configurado.");
  const response = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new MercadoPagoError(`Mercado Pago recusou: ${body?.message ?? response.status}`, response.status);
  }
  return body;
}

export async function createPreapproval(input: {
  reason: string;
  externalReference: string;
  payerEmail: string;
  amountCents: number;
  backUrl: string;
}): Promise<{ id: string; init_point: string }> {
  return call("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: input.reason,
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      back_url: input.backUrl,
      status: "pending",
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: input.amountCents / 100,
        currency_id: "BRL",
      },
    }),
  });
}

export async function getPreapproval(id: string): Promise<any> {
  return call(`/preapproval/${encodeURIComponent(id)}`);
}

export async function cancelPreapproval(id: string): Promise<any> {
  return call(`/preapproval/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ status: "cancelled" }),
  });
}

export async function getAuthorizedPayment(id: string): Promise<any> {
  return call(`/authorized_payments/${encodeURIComponent(id)}`);
}
