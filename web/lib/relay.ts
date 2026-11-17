import { randomBytes } from "node:crypto";
import { del, list } from "@vercel/blob";
import { one, sql } from "./db";
import { hashSecret } from "./license";
import { safeEqual } from "./security";

/**
 * Sending files from the customer's phone over the internet (store Wi-Fi or 4G/5G).
 *
 * The kiosk opens a session and shows its link as a QR Code. The phone uploads straight to
 * Vercel Blob (private store) under relay/<code>/. The kiosk lists, downloads and deletes the
 * files with the session secret. Nothing stays longer than the session (30 minutes): closed or
 * expired sessions have their files deleted on the next cleanup.
 */

export const RELAY_MINUTES = 30;
export const RELAY_MAX_FILES = 20;
export const RELAY_MAX_BYTES = 50 * 1024 * 1024;
export const RELAY_BASE_URL = "https://imprime-ai.vercel.app";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function newRelayCode(): string {
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function isRelayCode(code: string): boolean {
  return /^[a-z2-9]{10}$/.test(code);
}

export function relayPrefix(code: string): string {
  return `relay/${code}/`;
}

export type RelaySession = { code: string; secretHash: string; kioskName: string; expiresAt: Date };

/** The session if it is still open (not closed, not expired). */
export async function openRelaySession(code: string): Promise<RelaySession | null> {
  if (!isRelayCode(code)) return null;
  const row = await one`
    select code, secret_hash, kiosk_name, expires_at from relay_sessions
    where code = ${code} and closed_at is null and expires_at > now()`;
  if (!row) return null;
  return { code: row.code, secretHash: row.secret_hash, kioskName: row.kiosk_name, expiresAt: new Date(row.expires_at) };
}

/** The session only when the request carries its secret ("Authorization: Bearer <secret>"). */
export async function authorizedRelaySession(request: Request, code: string): Promise<RelaySession | null> {
  const session = await openRelaySession(code);
  if (!session) return null;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (given.length < 20 || !safeEqual(hashSecret(given), session.secretHash)) return null;
  return session;
}

export async function createRelaySession(kioskName: string) {
  const code = newRelayCode();
  const secret = randomBytes(24).toString("base64url");
  const name = kioskName.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40);
  await sql`insert into relay_sessions (code, secret_hash, kiosk_name, expires_at)
            values (${code}, ${hashSecret(secret)}, ${name}, now() + make_interval(mins => ${RELAY_MINUTES}))`;
  return { code, secret, url: `${RELAY_BASE_URL}/e/${code}`, expiresInSeconds: RELAY_MINUTES * 60 };
}

export type RelayFile = { pathname: string; name: string; size: number; uploadedAt: string };

export async function listRelayFiles(code: string): Promise<RelayFile[]> {
  const files: RelayFile[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: relayPrefix(code), cursor, limit: 100 });
    for (const b of page.blobs) {
      files.push({
        pathname: b.pathname,
        name: b.pathname.split("/").pop() || "arquivo",
        size: b.size,
        uploadedAt: new Date(b.uploadedAt).toISOString(),
      });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  files.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  return files;
}

/** A pathname the phone may upload to: relay/<code>/<random>/<file name>. */
export function validRelayPathname(code: string, pathname: string): boolean {
  if (!pathname.startsWith(relayPrefix(code))) return false;
  const rest = pathname.slice(relayPrefix(code).length).split("/");
  return rest.length === 2 && /^[a-z0-9]{6,40}$/.test(rest[0]) && rest[1].length > 0 && rest[1].length <= 120 && !rest[1].includes("..");
}

export async function deleteRelayFiles(code: string) {
  const files = await listRelayFiles(code);
  if (files.length) await del(files.map((f) => f.pathname));
}

export async function closeRelaySession(code: string) {
  await sql`update relay_sessions set closed_at = now() where code = ${code} and closed_at is null`;
  await deleteRelayFiles(code);
}

/**
 * Deletes the files of sessions that were closed or expired, and old session rows.
 * Runs now and then when a kiosk opens a session, so it needs no cron.
 */
export async function cleanupRelay() {
  const stale = await sql`
    select code from relay_sessions
    where closed_at is not null or expires_at < now()
    order by created_at limit 30`;
  for (const row of stale) {
    const code = String(row.code);
    try {
      await deleteRelayFiles(code);
      await sql`delete from relay_sessions where code = ${code}`;
    } catch (error) {
      console.error("relay cleanup", code, error);
    }
  }
}

export function relayAuthorizedOnly() {
  return Response.json({ error: "Sessão encerrada ou expirada." }, { status: 404 });
}

/** Leaves only safe characters in a file name the phone sends, keeping the extension. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-100);
  return cleaned || "arquivo";
}

