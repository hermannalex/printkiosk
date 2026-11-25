import { randomUUID } from "node:crypto";
import { one, sql } from "./db";
import { effectiveConfig } from "./kiosk-config";
import type { KioskRow } from "./kiosk-auth";
import { kioskStatus } from "./kiosks";
import { openToken } from "./store";
import { brasiliaIso, mp } from "./store-pix";

/**
 * Pix for the web station. The owner's Mercado Pago token stays sealed in the database; the station
 * only sends how many sheets it wants to print. The price is the one saved in the panel, so a page
 * cannot ask for a cheaper charge, and a payment is only believed after it is read back from
 * Mercado Pago with the right amount and reference.
 */

export class PixError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const MAX_SHEETS = 2000;
// Mercado Pago requires at least 30 minutes of validity; the station gives up and cancels much sooner.
const VALID_MINUTES = 30;

const reference = (id: number | string) => `imprime-kiosk-${id}`;

function tokenOf(kiosk: KioskRow): string {
  if (!kiosk.mp_token_enc) throw new PixError("O Pix ainda não foi ativado. O dono precisa cadastrar o token do Mercado Pago no painel.", 409);
  try {
    return openToken(kiosk.mp_token_enc);
  } catch {
    throw new PixError("Não foi possível ler o token do Mercado Pago. Cadastre-o de novo no painel.", 409);
  }
}

function mpError(error: unknown): PixError {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) return new PixError("O Mercado Pago recusou o token. Cadastre o token de novo no painel.", 409);
  const detail = error instanceof Error ? error.message : "";
  return new PixError(detail || "Não foi possível falar com o Mercado Pago. Tente de novo.", 502);
}

export async function createKioskPix(kiosk: KioskRow, sheetsInput: unknown) {
  if (kioskStatus({ paid_until: kiosk.paid_until, last_seen_at: new Date() }) !== "active") {
    throw new PixError("A assinatura desta estação não está ativa. Renove no painel para cobrar por Pix.", 402);
  }
  const sheets = Math.round(Number(sheetsInput));
  if (!Number.isFinite(sheets) || sheets < 1 || sheets > MAX_SHEETS) throw new PixError("Quantidade de folhas inválida.");
  // Only what the owner saved in the dashboard counts: what the station reports about itself could be edited in its browser.
  const config = effectiveConfig(kiosk.config, null);
  if (config.pricePerPageCents <= 0) throw new PixError("Defina o preço por página no painel para cobrar por Pix.", 409);
  const amountCents = config.pricePerPageCents * sheets;
  if (amountCents > 500_000) throw new PixError("Valor acima do permitido para um pedido.");

  const token = tokenOf(kiosk);
  let payerEmail = config.payerEmail;
  if (!payerEmail && kiosk.owner_id) {
    payerEmail = String((await one`select email from users where id = ${kiosk.owner_id}`)?.email ?? "");
  }
  if (!payerEmail) throw new PixError("Informe o e-mail do pagador Pix nas configurações do quiosque, no painel.", 409);

  const expires = new Date(Date.now() + VALID_MINUTES * 60_000);
  const row = await one`insert into kiosk_pix (kiosk_id, amount_cents, sheets, expires_at)
                        values (${kiosk.id}, ${amountCents}, ${sheets}, ${expires.toISOString()}) returning id`;
  const id = Number(row!.id);
  try {
    const payment = await mp(token, "/v1/payments", {
      method: "POST",
      headers: { "X-Idempotency-Key": `imprime-kiosk-${id}-${randomUUID()}` },
      body: JSON.stringify({
        transaction_amount: amountCents / 100,
        payment_method_id: "pix",
        description: `Impressão · ${config.kioskName}`.slice(0, 120),
        external_reference: reference(id),
        date_of_expiration: brasiliaIso(expires),
        payer: { email: payerEmail },
      }),
    });
    const qr = payment?.point_of_interaction?.transaction_data?.qr_code;
    if (!payment?.id || !qr) throw new PixError("O Mercado Pago não gerou o Pix. Confira se a conta tem uma chave Pix.", 502);
    await sql`update kiosk_pix set mp_payment_id = ${String(payment.id)}, pix_qr = ${qr} where id = ${id}`;
    return { id, amountCents, sheets, qr: String(qr), expiresAt: expires.toISOString() };
  } catch (error) {
    await sql`delete from kiosk_pix where id = ${id}`;
    throw error instanceof PixError ? error : mpError(error);
  }
}

type Row = Record<string, any>;

async function ownRow(kiosk: KioskRow, idInput: unknown): Promise<Row> {
  const id = Math.round(Number(idInput));
  const row = Number.isFinite(id) ? await one`select * from kiosk_pix where id = ${id} and kiosk_id = ${kiosk.id}` : null;
  if (!row) throw new PixError("Cobrança não encontrada.", 404);
  return row;
}

const view = (row: Row, status: string) => ({ id: Number(row.id), status, amountCents: Number(row.amount_cents), sheets: Number(row.sheets) });

/** Reads the charge back from Mercado Pago and moves it on: pending → approved / cancelled / expired. */
export async function pixStatus(kiosk: KioskRow, idInput: unknown) {
  const row = await ownRow(kiosk, idInput);
  if (row.status !== "pending") return view(row, row.status);

  const token = tokenOf(kiosk);
  let payment: any;
  try {
    payment = await mp(token, `/v1/payments/${encodeURIComponent(String(row.mp_payment_id))}`);
  } catch (error) {
    throw mpError(error);
  }
  const paidRight =
    payment?.external_reference === reference(row.id) &&
    Math.round(Number(payment?.transaction_amount) * 100) === Number(row.amount_cents);

  if (payment?.status === "approved" && paidRight) {
    await sql`update kiosk_pix set status = 'approved', paid_at = now() where id = ${row.id} and status = 'pending'`;
    return view(row, "approved");
  }
  if (["cancelled", "rejected", "refunded", "charged_back"].includes(String(payment?.status))) {
    await sql`update kiosk_pix set status = 'cancelled' where id = ${row.id} and status = 'pending'`;
    return view(row, "cancelled");
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await sql`update kiosk_pix set status = 'expired' where id = ${row.id} and status = 'pending'`;
    return view(row, "expired");
  }
  return view(row, "pending");
}

/** The customer gave up (or the time ran out): the QR Code stops working. Never cancels a paid charge. */
export async function cancelPix(kiosk: KioskRow, idInput: unknown) {
  const row = await ownRow(kiosk, idInput);
  if (row.status !== "pending") return view(row, row.status);
  const current = await pixStatus(kiosk, row.id); // may find out it was paid in the meantime
  if (current.status !== "pending") return current;
  try {
    await mp(tokenOf(kiosk), `/v1/payments/${encodeURIComponent(String(row.mp_payment_id))}`, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
  } catch {
    // The charge also expires by itself; the station is done with it either way.
  }
  await sql`update kiosk_pix set status = 'cancelled' where id = ${row.id} and status = 'pending'`;
  return view(row, "cancelled");
}

/** A paid charge releases one print job: the first call wins, so reloading the page cannot print again. */
export async function consumePix(kiosk: KioskRow, idInput: unknown) {
  const row = await ownRow(kiosk, idInput);
  if (row.status !== "approved") throw new PixError("Este Pix ainda não foi pago.", 409);
  const claimed = await one`update kiosk_pix set used_at = now() where id = ${row.id} and used_at is null returning id`;
  if (!claimed) throw new PixError("Este pagamento já foi usado em uma impressão.", 409);
  return { ...view(row, "approved"), paymentId: String(row.mp_payment_id) };
}

