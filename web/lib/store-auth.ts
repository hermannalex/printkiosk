import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { one, sql } from "./db";

/**
 * Sign-in of the online store's customers (not store owners: they use lib/auth.ts).
 * Its own cookie and table; a customer account belongs to one store.
 */

export type Customer = { id: number; storeId: number; name: string; email: string };

const PRODUCTION = process.env.NODE_ENV === "production";
const COOKIE = PRODUCTION ? "__Host-pk_cliente" : "pk_cliente";
const SESSION_DAYS = 30;

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function startCustomerSession(customerId: number) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await sql`insert into customer_sessions (id_hash, customer_id, expires_at) values (${tokenHash(token)}, ${customerId}, ${expires.toISOString()})`;
  await sql`delete from customer_sessions where expires_at < now()`;
  const store = await cookies();
  store.set(COOKIE, token, { httpOnly: true, secure: PRODUCTION, sameSite: "lax", path: "/", expires });
}

export async function endCustomerSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await sql`delete from customer_sessions where id_hash = ${tokenHash(token)}`;
  store.delete(COOKIE);
}

/** The signed-in customer of this store, or null. */
export async function currentCustomer(storeId: number): Promise<Customer | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const row = await one`
    select c.id, c.store_id, c.name, c.email
    from customer_sessions s join store_customers c on c.id = s.customer_id
    where s.id_hash = ${tokenHash(token)} and s.expires_at > now() and c.store_id = ${storeId}`;
  if (!row) return null;
  return { id: Number(row.id), storeId: Number(row.store_id), name: row.name, email: row.email };
}
