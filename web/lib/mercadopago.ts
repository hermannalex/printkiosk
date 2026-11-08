/** Mercado Pago subscriptions (Assinaturas / preapproval) for the monthly plans. */

const API = "https://api.mercadopago.com";

/** The access token, without spaces or line breaks that often come along when it is pasted. */
function accessToken(): string {
  return (process.env.MERCADOPAGO_ACCESS_TOKEN ?? "").replace(/\s+/g, "").replace(/^Bearer/i, "");
}

export function mercadoPagoConfigured(): boolean {
  return !!accessToken();
}

export class MercadoPagoError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call(path: string, init: RequestInit = {}): Promise<any> {
  const token = accessToken();
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
    const code = body?.code ?? body?.error;
    throw new MercadoPagoError(`Mercado Pago recusou (${response.status}${code ? `, ${code}` : ""}): ${body?.message ?? "sem detalhe"}`, response.status);
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

/** For the master's check page: which kind of token is configured (never the token itself) and who it belongs to. */
export async function describeToken(): Promise<{
  configured: boolean;
  shape: string;
  ok: boolean;
  account?: string;
  error?: string;
}> {
  const token = accessToken();
  if (!token) return { configured: false, shape: "", ok: false, error: "Variável MERCADOPAGO_ACCESS_TOKEN vazia." };
  const kind = token.startsWith("APP_USR-") ? "APP_USR (produção)" : token.startsWith("TEST-") ? "TEST (teste)" : "formato desconhecido";
  const shape = `${kind}, começa com "${token.slice(0, 8)}…", ${token.length} caracteres`;
  try {
    const me = await call("/users/me");
    return { configured: true, shape, ok: true, account: `${me.nickname ?? ""} (id ${me.id}, ${me.site_id ?? ""})` };
  } catch (error) {
    return { configured: true, shape, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type TokenCheck = { label: string; ok: boolean; detail: string };

/** One call per permission the panel uses, so a refusal shows which part is blocked. */
export async function checkPermissions(): Promise<TokenCheck[]> {
  const probes: [string, string][] = [
    ["Conta (users/me)", "/users/me"],
    ["Pagamentos (consulta, usada pelo webhook)", "/v1/payments/search?limit=1"],
    ["Assinaturas (planos mensais)", "/preapproval/search?limit=1"],
    ["Meios de pagamento", "/v1/payment_methods"],
  ];
  return Promise.all(
    probes.map(async ([label, path]) => {
      try {
        await call(path);
        return { label, ok: true, detail: "aceito" };
      } catch (error) {
        return { label, ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}
