import { one } from "./db";
import { hashSecret, normalizeStoreCode } from "./license";
import { safeEqual } from "./security";

export type KioskRow = {
  id: number | string;
  store_code: string;
  owner_id: number | string | null;
  plan: string;
  paid_until: string | Date | null;
  config: unknown;
  reported_config: unknown;
  mp_token_enc: string | null;
};

/** The kiosk that owns this store code and secret (the same pair /api/kiosk/sync uses), or null. */
export async function authKiosk(body: unknown): Promise<KioskRow | null> {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const storeCode = normalizeStoreCode(String(o.storeCode ?? ""));
  const secret = String(o.secret ?? "");
  if (!storeCode || secret.length < 16 || secret.length > 200) return null;
  const kiosk = await one`select id, store_code, secret_hash, owner_id, plan, paid_until, config, reported_config, mp_token_enc
                          from kiosks where store_code = ${storeCode}`;
  if (!kiosk?.secret_hash || !safeEqual(String(kiosk.secret_hash), hashSecret(secret))) return null;
  return kiosk as unknown as KioskRow;
}
