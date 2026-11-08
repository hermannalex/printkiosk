import { one, sql } from "./db";
import { isoOf, todayIso } from "./format";
import { makeActivationCode } from "./license";

export type KioskStatus = "active" | "expired" | "demo" | "never";

export function kioskStatus(kiosk: { paid_until?: string | Date | null; last_seen_at?: string | Date | null }): KioskStatus {
  const until = isoOf(kiosk.paid_until);
  if (until) return until >= todayIso() ? "active" : "expired";
  return kiosk.last_seen_at ? "demo" : "never";
}

export const STATUS_LABEL: Record<KioskStatus, string> = {
  active: "Ativo",
  expired: "Vencido",
  demo: "Demonstração",
  never: "Aguardando conexão",
};

/**
 * Extends a kiosk's subscription and signs a new activation code for it.
 * With `untilIso`, the code is valid until that day; otherwise it adds `months`
 * to the later of today and the current paid_until.
 */
export async function extendKiosk(
  kioskId: number,
  options: { months?: number; untilIso?: string; source: "manual" | "payment"; byUserId?: number | null },
): Promise<{ code: string; validUntil: string }> {
  // One UPDATE computes and stores the new date, so two extensions at the same time (a payment
  // and a manual one, or a webhook delivered twice) add up instead of overwriting each other.
  const months = Math.max(1, Math.min(24, options.months ?? 1));
  const kiosk = options.untilIso
    ? await one`update kiosks set paid_until = ${options.untilIso}::date where id = ${kioskId}
                returning store_code, paid_until`
    : await one`update kiosks set paid_until = (
                  greatest(coalesce(paid_until, (now() at time zone 'America/Sao_Paulo')::date),
                           (now() at time zone 'America/Sao_Paulo')::date)
                  + make_interval(months => ${months}))::date
                where id = ${kioskId}
                returning store_code, paid_until`;
  if (!kiosk) throw new Error("Quiosque não encontrado.");

  const validUntil = isoOf(kiosk.paid_until)!;
  const code = makeActivationCode(kiosk.store_code, validUntil);
  await sql`insert into activation_codes (kiosk_id, code, valid_until, source, created_by)
            values (${kioskId}, ${code}, ${validUntil}, ${options.source}, ${options.byUserId ?? null})`;
  return { code, validUntil };
}

export async function latestCode(kioskId: number) {
  return one`select code, valid_until, created_at, source from activation_codes
             where kiosk_id = ${kioskId} order by valid_until desc, id desc limit 1`;
}

/** True when the owner has at least one kiosk on the Pro plan with a paid month. */
export async function ownerHasPro(ownerId: number): Promise<boolean> {
  const row = await one`select 1 from kiosks
                        where owner_id = ${ownerId} and plan = 'pro' and paid_until >= ${todayIso()} limit 1`;
  return !!row;
}
