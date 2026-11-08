import { del, get, list, put } from "@vercel/blob";
import { query } from "./db";
import { sealBackup } from "./backup-crypto";
import { BACKUP_PUBLIC_KEY } from "./backup-public-key";

/**
 * Daily logical backup: every table exported as JSON, encrypted (lib/backup-crypto.ts) and kept in
 * the private Vercel Blob store "quioco-backups" — outside Neon, so a lost or damaged database
 * project does not take the backups with it. Neon's own snapshots are the first line; this is the second.
 */

export const PREFIX = "backups/";
export const KEEP_DAYS = 35;
const KEEP_AT_LEAST = 7;
const NAME = /^backups\/quioco-[0-9TZ-]+\.qbk$/;

// Short-lived tables, rebuilt by themselves: not worth keeping (and sessions are better lost).
const SKIP = new Set(["sessions", "login_challenges", "rate_limits"]);
// Restore order: parents before children (foreign keys). Tables not listed go last.
const ORDER = ["users", "kiosks", "subscriptions", "payments", "activation_codes", "print_jobs", "audit_log"];

export type BackupTable = { columns: string[]; rows: unknown[][] };
export type BackupExport = { format: "quioco-backup"; version: 1; created_at: string; tables: Record<string, BackupTable> };

export async function exportDatabase(): Promise<BackupExport> {
  const found = await query(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const names = found.map((r) => String(r.table_name)).filter((n) => !SKIP.has(n) && /^[a-z_][a-z0-9_]*$/.test(n));
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const tables: Record<string, BackupTable> = {};
  for (const name of names) {
    const cols = await query(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`,
      [name],
    );
    const columns = cols.map((c) => String(c.column_name));
    const order = columns.includes("id") ? " order by id" : "";
    const rows = await query(`select * from "${name}"${order}`);
    tables[name] = { columns, rows: rows.map((row) => columns.map((c) => row[c] ?? null)) };
  }
  return { format: "quioco-backup", version: 1, created_at: new Date().toISOString(), tables };
}

function rank(name: string) {
  const i = ORDER.indexOf(name);
  return i < 0 ? ORDER.length : i;
}

export type BackupResult = { pathname: string; bytes: number; tables: number; rows: number; removed: number };

export async function runBackup(): Promise<BackupResult> {
  const data = await exportDatabase();
  const file = sealBackup(Buffer.from(JSON.stringify(data)), BACKUP_PUBLIC_KEY);
  const stamp = data.created_at.replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  const pathname = `${PREFIX}quioco-${stamp}.qbk`;
  await put(pathname, file, {
    access: "private",
    contentType: "application/octet-stream",
    addRandomSuffix: false,
  });
  const removed = await pruneBackups();
  const rows = Object.values(data.tables).reduce((sum, t) => sum + t.rows.length, 0);
  return { pathname, bytes: file.length, tables: Object.keys(data.tables).length, rows, removed };
}

export type StoredBackup = { pathname: string; url: string; size: number; uploadedAt: Date };

export async function listBackups(): Promise<StoredBackup[]> {
  const all: StoredBackup[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const b of page.blobs) all.push({ pathname: b.pathname, url: b.url, size: b.size, uploadedAt: new Date(b.uploadedAt) });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return all.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
}

/** Deletes backups older than KEEP_DAYS, but never the newest KEEP_AT_LEAST (in case the cron stopped). */
export async function pruneBackups(): Promise<number> {
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const old = (await listBackups()).slice(KEEP_AT_LEAST).filter((b) => b.uploadedAt.getTime() < cutoff);
  if (old.length) await del(old.map((b) => b.url));
  return old.length;
}

export function isBackupName(pathname: string): boolean {
  return NAME.test(pathname);
}

export async function readBackup(pathname: string) {
  if (!isBackupName(pathname)) return null;
  const result = await get(pathname, { access: "private" });
  return result?.statusCode === 200 ? result : null;
}
