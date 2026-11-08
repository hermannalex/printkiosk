import { one, sql } from "./db";
import { addMonthsIso, isoOf, todayIso } from "./format";
import { makeActivationCode } from "./license";

export type KioskStatus = "active" | "expired" | "demo" | "never";

export function kioskStatus(kiosk: { paid_until: string | Date | null; last_seen_at: string | Date | null }): KioskStatus {
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
  const kiosk = await one`select id, store_code, paid_until from kiosks where id = ${kioskId}`;
  if (!kiosk) throw new Error("Quiosque não encontrado.");

  let validUntil = options.untilIso;
  if (!validUntil) {
    const today = todayIso();
    const current = isoOf(kiosk.paid_until);
    const base = current && current > today ? current : today;
    validUntil = addMonthsIso(base, options.months ?? 1);
  }

  const code = makeActivationCode(kiosk.store_code, validUntil);
  await sql`insert into activation_codes (kiosk_id, code, valid_until, source, created_by)
            values (${kioskId}, ${code}, ${validUntil}, ${options.source}, ${options.byUserId ?? null})`;
  await sql`update kiosks set paid_until = ${validUntil} where id = ${kioskId}`;
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
