import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { todayIso } from "@/lib/format";
import { hashSecret, normalizeStoreCode } from "@/lib/license";
import { ipFromHeaders, rateLimit, safeEqual } from "@/lib/security";
import { normalizeVoucherCode } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Credit vouchers, called by the kiosk at checkout.
 *  check  { code }                     → balance
 *  redeem { code, amountCents, ref }   → takes the amount once per ref (a retry is safe)
 *  refund { ref }                      → gives it back when the print failed
 * Only a registered kiosk with an owner may call it, and only for that owner's vouchers.
 */
export async function POST(request: Request) {
  const ip = ipFromHeaders(request.headers);
  if (!(await rateLimit(`voucher:ip:${ip}`, 120, 60 * 60))) return reply({ ok: false, error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
  const body = await request.json().catch(() => null);
  const storeCode = normalizeStoreCode(String(body?.storeCode ?? ""));
  const secret = String(body?.secret ?? "");
  if (!storeCode || secret.length < 16 || secret.length > 200) return reply({ ok: false, error: "Quiosque inválido." }, 400);

  const kiosk = await one`select id, owner_id, secret_hash from kiosks where store_code = ${storeCode}`;
  if (!kiosk?.secret_hash || !safeEqual(String(kiosk.secret_hash), hashSecret(secret))) {
    return reply({ ok: false, error: "Quiosque não reconhecido pelo painel." }, 403);
  }
  if (!kiosk.owner_id) return reply({ ok: false, error: "Este quiosque ainda não foi cadastrado no painel da loja." });
  const kioskId = Number(kiosk.id);
  const ownerId = Number(kiosk.owner_id);
  const action = String(body?.action ?? "");
  const ref = String(body?.ref ?? "").slice(0, 64);

  if (action === "refund") {
    if (!ref) return reply({ ok: false, error: "Referência ausente." }, 400);
    const row = await one`
      with use as (update voucher_uses set refunded = true
                   where kiosk_id = ${kioskId} and ref = ${ref} and not refunded
                   returning voucher_id, amount_cents)
      update vouchers v set balance_cents = v.balance_cents + use.amount_cents
      from use where v.id = use.voucher_id returning v.balance_cents`;
    return reply({ ok: true, balanceCents: row ? Number(row.balance_cents) : null });
  }

  // Wrong codes are counted per kiosk, so nobody can try codes until one works.
  if (!(await rateLimit(`voucher:kiosk:${kioskId}`, 40, 10 * 60))) {
    return reply({ ok: false, error: "Muitas tentativas neste quiosque. Aguarde alguns minutos." }, 429);
  }
  const code = normalizeVoucherCode(String(body?.code ?? ""));
  if (!code) return reply({ ok: false, error: "Código de voucher inválido. Confira e digite de novo." });
  const today = todayIso();
  const voucher = await one`select id, balance_cents, disabled, expires_on from vouchers where code = ${code} and owner_id = ${ownerId}`;
  if (!voucher) return reply({ ok: false, error: "Voucher não encontrado. Confira o código." });
  if (voucher.disabled) return reply({ ok: false, error: "Este voucher foi desativado pela loja." });
  if (voucher.expires_on && new Date(voucher.expires_on).toISOString().slice(0, 10) < today) {
    return reply({ ok: false, error: "Este voucher venceu." });
  }

  if (action === "check") return reply({ ok: true, code, balanceCents: Number(voucher.balance_cents) });

  if (action !== "redeem") return reply({ ok: false, error: "Ação inválida." }, 400);
  const amount = Math.round(Number(body?.amountCents));
  if (!ref || !Number.isInteger(amount) || amount < 1 || amount > 100000) return reply({ ok: false, error: "Valor inválido." }, 400);

  // One statement: the balance check, the discount and the record of the use happen together.
  const row = await one`
    with prior as (select balance_after from voucher_uses where kiosk_id = ${kioskId} and ref = ${ref} and not refunded),
    upd as (update vouchers set balance_cents = balance_cents - ${amount}, last_used_at = now()
            where id = ${voucher.id} and not disabled and balance_cents >= ${amount}
              and (expires_on is null or expires_on >= ${today}::date)
              and not exists (select 1 from prior)
            returning id, balance_cents),
    ins as (insert into voucher_uses (voucher_id, kiosk_id, ref, amount_cents, balance_after)
            select id, ${kioskId}, ${ref}, ${amount}, balance_cents from upd returning balance_after)
    select (select balance_after from prior) as prior_balance, (select balance_after from ins) as new_balance`;
  const balance = row?.new_balance ?? row?.prior_balance;
  if (balance == null) {
    return reply({ ok: false, error: `Saldo insuficiente. Este voucher tem ${(Number(voucher.balance_cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`, balanceCents: Number(voucher.balance_cents) });
  }
  return reply({ ok: true, code, balanceCents: Number(balance) });
}
