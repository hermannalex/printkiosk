import { one } from "./db";

export type PlanId = "basic" | "pro";

/** Monthly prices, per kiosk. Pro: the first kiosk of an account pays `cents`, each extra one `extraCents`. */
export const PLANS: Record<PlanId, { name: string; cents: number; extraCents?: number; summary: string; features: string[] }> = {
  basic: {
    name: "Básico",
    cents: 1999,
    summary: "O app do quiosque liberado.",
    features: ["Impressões ilimitadas no quiosque", "Pix e envio pelo celular", "Renovação automática do código"],
  },
  pro: {
    name: "Pro",
    cents: 4999,
    extraCents: 999,
    summary: "O app + o dashboard da loja.",
    features: [
      "Tudo do Básico",
      "Faturamento e cópias por dia",
      "Estatísticas por quiosque e horário",
      "Histórico de impressões",
    ],
  },
};

export function planName(plan: string | null | undefined): string {
  return plan === "pro" ? PLANS.pro.name : PLANS.basic.name;
}

/**
 * Whether the owner already pays the full Pro price on another kiosk (an active Pro subscription,
 * or a Pro kiosk paid by hand that is still valid). Then this kiosk is an extra one.
 */
export async function ownerHasPaidPro(ownerId: number, exceptKioskId: number): Promise<boolean> {
  const row = await one`
    select 1 from kiosks k
    where k.owner_id = ${ownerId} and k.id <> ${exceptKioskId}
      and (
        exists (select 1 from subscriptions s where s.kiosk_id = k.id and s.plan = 'pro' and s.status = 'authorized')
        or (k.plan = 'pro' and k.paid_until >= current_date)
      )
    limit 1`;
  return !!row;
}

/** Monthly price of `plan` for this kiosk, in cents. */
export async function monthlyPrice(plan: PlanId, ownerId: number | null, kioskId: number): Promise<{ cents: number; extra: boolean }> {
  if (plan === "pro" && ownerId && (await ownerHasPaidPro(ownerId, kioskId))) {
    return { cents: PLANS.pro.extraCents!, extra: true };
  }
  return { cents: PLANS[plan].cents, extra: false };
}
