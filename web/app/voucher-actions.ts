"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { one, sql } from "@/lib/db";
import { brl, parseBRL, todayIso } from "@/lib/format";
import { audit, rateLimit } from "@/lib/security";
import { newVoucherCode } from "@/lib/vouchers";

const go = (key: "msg" | "erro", text: string, extra = ""): never =>
  redirect(`/painel/vouchers?${key}=${encodeURIComponent(text)}${extra}`);

export async function createVouchers(form: FormData) {
  const user = await requireUser();
  if (!(await rateLimit(`vouchers:user:${user.id}`, 30, 60 * 60))) go("erro", "Muitos vouchers criados nesta hora. Tente mais tarde.");
  const cents = parseBRL(String(form.get("valor") ?? "").slice(0, 20));
  if (cents === null || cents < 100 || cents > 100000) go("erro", "Informe um valor de R$ 1,00 a R$ 1.000,00.");
  const qty = Math.round(Number(form.get("quantidade") ?? 1));
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) go("erro", "Crie de 1 a 100 vouchers por vez.");
  const expires = String(form.get("validade") ?? "").trim();
  if (expires && (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || expires < todayIso())) go("erro", "A validade precisa ser uma data a partir de hoje.");
  const note = String(form.get("observacao") ?? "").trim().slice(0, 80) || null;
  const count = await one`select count(*)::int as n from vouchers where owner_id = ${user.id} and created_at > now() - interval '1 day'`;
  if (Number(count?.n ?? 0) + qty > 500) go("erro", "Limite de 500 vouchers por dia.");

  const batch = newVoucherCode().replace("-", "").slice(0, 8);
  const codes = Array.from({ length: qty }, newVoucherCode);
  await sql`insert into vouchers (owner_id, code, value_cents, balance_cents, note, batch, expires_on)
            select ${user.id}, c, ${cents}, ${cents}, ${note}, ${batch}, ${expires || null}::date
            from unnest(${codes}::text[]) as c
            on conflict (code) do nothing`;
  await audit(user.id, "vouchers_criados", batch, `${qty} × ${brl(cents!)}`);
  revalidatePath("/painel/vouchers");
  go("msg", `${qty} voucher(s) de ${brl(cents!)} criado(s).`, `&lote=${batch}`);
}

export async function toggleVoucher(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const row = await one`update vouchers set disabled = not disabled where id = ${id} and owner_id = ${user.id} returning code, disabled`;
  if (!row) go("erro", "Voucher não encontrado.");
  await audit(user.id, row!.disabled ? "voucher_desativado" : "voucher_reativado", row!.code);
  revalidatePath("/painel/vouchers");
  go("msg", row!.disabled ? `Voucher ${row!.code} desativado.` : `Voucher ${row!.code} reativado.`);
}
