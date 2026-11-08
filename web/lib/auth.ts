import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { one } from "./db";

export type User = {
  id: number;
  email: string;
  name: string;
  role: "owner" | "master";
  phone: string | null;
};

const COOKIE = "pk_session";
const SESSION_DAYS = 30;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) throw new Error("SESSION_SECRET não configurado.");
  return value;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(expected, actual);
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export async function startSession(userId: number) {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const value = `${userId}.${expires}`;
  const store = await cookies();
  store.set(COOKIE, `${value}.${sign(value)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expires),
  });
}

export async function endSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  const [id, expires, signature] = raw.split(".");
  if (!id || !expires || !signature) return null;
  const expected = sign(`${id}.${expires}`);
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return null;
  }
  if (Number(expires) < Date.now()) return null;
  const row = await one`select id, email, name, role, phone, blocked from users where id = ${Number(id)}`;
  if (!row || row.blocked) return null;
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
