import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { one, sql } from "./db";
import { clientIp, userAgent } from "./security";

export type User = {
  id: number;
  email: string;
  name: string;
  role: "owner" | "master";
  phone: string | null;
};

const PRODUCTION = process.env.NODE_ENV === "production";
// "__Host-" makes the browser refuse the cookie unless it is Secure, host-only and path=/.
const COOKIE = PRODUCTION ? "__Host-pk_session" : "pk_session";
const OWNER_SESSION_HOURS = 14 * 24;
const MASTER_SESSION_HOURS = 12;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

// scrypt N=2^15, r=8, p=1 (OWASP minimum); older hashes made with Node's default still verify.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, SCRYPT);
  return `scrypt2$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (!saltB64 || !hashB64 || (scheme !== "scrypt" && scheme !== "scrypt2")) return false;
  const expected = Buffer.from(hashB64, "base64");
  const params = scheme === "scrypt2" ? SCRYPT : {};
  const actual = scryptSync(password.slice(0, PASSWORD_MAX), Buffer.from(saltB64, "base64"), expected.length, params);
  return timingSafeEqual(expected, actual);
}

/** Old hashes use weaker parameters; re-hash them after a successful login. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith("scrypt2$");
}

// A real hash to compare against when the e-mail doesn't exist, so the response takes the same time.
const DUMMY_HASH = hashPassword(randomBytes(12).toString("hex"));
export function burnPasswordCheck(password: string) {
  verifyPassword(password, DUMMY_HASH);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function startSession(userId: number, role: User["role"]) {
  const token = randomBytes(32).toString("base64url");
  const hours = role === "master" ? MASTER_SESSION_HOURS : OWNER_SESSION_HOURS;
  const expires = new Date(Date.now() + hours * 3_600_000);
  await sql`insert into sessions (id_hash, user_id, expires_at, ip, user_agent)
            values (${tokenHash(token)}, ${userId}, ${expires.toISOString()}, ${await clientIp()}, ${await userAgent()})`;
  // Old sessions are cleaned up as people log in.
  await sql`delete from sessions where expires_at < now()`;
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: PRODUCTION,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await sql`delete from sessions where id_hash = ${tokenHash(token)}`;
  store.delete(COOKIE);
}

/** Ends every session of a user (blocked account, password change). */
export async function revokeSessions(userId: number) {
  await sql`delete from sessions where user_id = ${userId}`;
}

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const row = await one`
    select u.id, u.email, u.name, u.role, u.phone
    from sessions s join users u on u.id = s.user_id
    where s.id_hash = ${tokenHash(token)} and s.expires_at > now() and not u.blocked`;
  if (!row) return null;
  return { id: Number(row.id), email: row.email, name: row.name, role: row.role, phone: row.phone };
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/entrar");
  return user;
}

export async function requireMaster(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "master") redirect("/painel");
  return user;
}
