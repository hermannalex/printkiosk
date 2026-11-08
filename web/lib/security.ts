import { createHash, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { one, sql } from "./db";

/** Client IP as Vercel reports it (x-real-ip is set by the platform, not the client). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return ipFromHeaders(h);
}

export function ipFromHeaders(h: Headers): string {
  return (h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "desconhecido").trim().slice(0, 64);
}

export async function userAgent(): Promise<string> {
  return ((await headers()).get("user-agent") ?? "").slice(0, 200);
}

/**
 * Fixed-window counter kept in Postgres (serverless functions share no memory).
 * Returns true while `key` is still under `limit` hits in the current window.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const row = await one`
    insert into rate_limits (key, window_start, hits) values (${key}, now(), 1)
    on conflict (key) do update set
      hits = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.hits + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning hits`;
  // Clean old counters now and then so the table stays small.
  if (Math.random() < 0.02) {
    await sql`delete from rate_limits where window_start < now() - interval '1 day'`;
  }
  return Number(row?.hits ?? 0) <= limit;
}

/** Records who did what. Never throws: an audit failure must not break the action itself. */
export async function audit(userId: number | null, action: string, target?: string | null, detail?: string | null) {
  try {
    const ip = await clientIp().catch(() => null);
    await sql`insert into audit_log (user_id, action, target, detail, ip)
              values (${userId}, ${action}, ${target ?? null}, ${detail?.slice(0, 500) ?? null}, ${ip})`;
  } catch (error) {
    console.error("audit", action, error);
  }
}

/** Constant-time comparison for secrets of any length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
