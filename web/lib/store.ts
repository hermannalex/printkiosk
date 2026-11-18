import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { del, list } from "@vercel/blob";
import { one, sql } from "./db";
import { ownerHasEnterprise } from "./kiosks";
import { safeEqual } from "./security";
import { sanitizeStoreConfig, type StoreConfig } from "./store-price";

/**
 * Online store (Enterprise plan): the store's customers sign up, upload files, pay by Pix straight
 * to the store's own Mercado Pago account and pick up the prints. imprime.ai charges no fee on it.
 */

export const PUBLIC_URL = "https://imprime-ai.vercel.app";
export const STORE_MAX_BYTES = 50 * 1024 * 1024;
export const PAY_MINUTES = 30;
export const CUSTOMER_PASSWORD_MIN = 8;

export const UPLOAD_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "image/gif",
  "image/bmp",
];

export const ORDER_STATUS_LABEL: Record<string, string> = {
  awaiting_payment: "Aguardando pagamento",
  paid: "Pago, na fila",
  printing: "Imprimindo",
  ready: "Pronto para retirar",
  delivered: "Entregue",
  cancelled: "Cancelado",
  expired: "Pagamento expirou",
};

export const ORDER_STATUS_PILL: Record<string, string> = {
  awaiting_payment: "pill-demo",
  paid: "pill-pro",
  printing: "pill-pro",
  ready: "pill-active",
  delivered: "pill-never",
  cancelled: "pill-expired",
  expired: "pill-expired",
};

export type Store = {
  id: number;
  ownerId: number;
  slug: string;
  name: string;
  published: boolean;
  pickupInfo: string;
  config: StoreConfig;
  hasToken: boolean;
  tokenTail: string | null;
  notifyEmail: string | null;
};

function toStore(row: any): Store {
  return {
    id: Number(row.id),
    ownerId: Number(row.owner_id),
    slug: row.slug,
    name: row.name,
    published: !!row.published,
    pickupInfo: row.pickup_info ?? "",
    config: sanitizeStoreConfig(row.config),
    hasToken: !!row.mp_token_enc,
    tokenTail: row.mp_token_tail ?? null,
    notifyEmail: row.notify_email ?? null,
  };
}

export async function storeOfOwner(ownerId: number): Promise<Store | null> {
  const row = await one`select * from stores where owner_id = ${ownerId}`;
  return row ? toStore(row) : null;
}

export async function storeById(id: number): Promise<Store | null> {
  const row = await one`select * from stores where id = ${id}`;
  return row ? toStore(row) : null;
}

/** The store customers can use: published, with a Mercado Pago token and an active Enterprise plan. */
export async function openStore(slug: string): Promise<Store | null> {
  if (!isSlug(slug)) return null;
  const row = await one`select * from stores where slug = ${slug}`;
  if (!row) return null;
  const store = toStore(row);
  if (!store.published || !store.hasToken) return null;
  if (!(await ownerHasEnterprise(store.ownerId))) return null;
  return store;
}

// ---------------------------------------------------------------- slugs and codes

export function isSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug);
}

const RESERVED = new Set(["admin", "api", "painel", "master", "loja", "entrar", "cadastro", "imprime", "imprimeai", "suporte"]);

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function slugProblem(slug: string): string | null {
  if (!isSlug(slug)) return "Use de 3 a 40 letras minúsculas, números e hífens, sem acentos.";
  if (RESERVED.has(slug)) return "Este endereço é reservado. Escolha outro.";
  return null;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newOrderCode(): string {
  return Array.from(randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function isOrderCode(code: string): boolean {
  return /^[A-Z2-9]{6}$/.test(code);
}

// ---------------------------------------------------------------- the store's Mercado Pago token

function masterKey(label: string): Buffer {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 16) throw new Error("SESSION_SECRET não configurado.");
  return createHash("sha256").update(label + secret).digest();
}

/** AES-256-GCM with a key derived from SESSION_SECRET: the database alone does not reveal the token. */
export function sealToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey("imprime-store-mp:"), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function openToken(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Token em formato desconhecido.");
  const decipher = createDecipheriv("aes-256-gcm", masterKey("imprime-store-mp:"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export async function storeToken(storeId: number): Promise<string | null> {
  const row = await one`select mp_token_enc from stores where id = ${storeId}`;
  if (!row?.mp_token_enc) return null;
  try {
    return openToken(row.mp_token_enc);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- uploaded files

/** Folder where one customer's files go: loja/<store>/<customer>/. */
export function customerPrefix(storeId: number, customerId: number): string {
  return `loja/${storeId}/${customerId}/`;
}

/** A pathname the customer may upload to: loja/<store>/<customer>/<random>/<file name>. */
export function validStorePathname(storeId: number, customerId: number, pathname: string): boolean {
  const prefix = customerPrefix(storeId, customerId);
  if (!pathname.startsWith(prefix)) return false;
  const rest = pathname.slice(prefix.length).split("/");
  return rest.length === 2 && /^[a-z0-9]{6,40}$/.test(rest[0]) && rest[1].length > 0 && rest[1].length <= 120 && !rest[1].includes("..");
}

export type CheckedFile = { pathname: string; name: string; kind: "pdf" | "image"; size: number; pages: number };

const fileKey = () => masterKey("imprime-store-file:");

/** Signs what the server found in a file (pages, size), so the order can trust it without reading it again. */
export function signFile(storeId: number, customerId: number, file: CheckedFile): string {
  return createHmac("sha256", fileKey())
    .update([storeId, customerId, file.pathname, file.kind, file.size, file.pages].join("|"))
    .digest("base64url");
}

export function fileSignatureValid(storeId: number, customerId: number, file: CheckedFile, token: string): boolean {
  return typeof token === "string" && token.length > 20 && safeEqual(signFile(storeId, customerId, file), token);
}

export function kindOf(name: string, contentType: string): "pdf" | "image" | null {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if ((mime.startsWith("image/") && mime !== "image/svg+xml") || ["jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "bmp"].includes(ext)) {
    return "image";
  }
  return null;
}

/** Counts the pages of a PDF. Falls back to counting page objects when the file is damaged. */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const pages = pdf.getPageCount();
    if (pages > 0) return pages;
  } catch {
    // fall through
  }
  const text = Buffer.from(bytes).toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return matches?.length ?? 0;
}

/** The content type to serve a stored file with: only PDFs and common photos, never anything a browser runs. */
export function servedType(kind: string, contentType: string): string {
  if (kind === "pdf") return "application/pdf";
  const mime = contentType.split(";")[0].trim().toLowerCase();
  return UPLOAD_TYPES.includes(mime) && mime !== "application/pdf" ? mime : "application/octet-stream";
}

// ---------------------------------------------------------------- cleanup

/**
 * Deletes the files of finished orders (delivered or cancelled 7 days ago), expires unpaid
 * orders, and removes uploads that never became an order. Runs daily from the cron and now
 * and then when an order is created.
 */
export async function cleanupStores(deep = false) {
  await sql`update store_orders set status = 'expired', updated_at = now()
            where status = 'awaiting_payment' and pay_expires_at < now() - interval '10 minutes'`;
  const done = await sql`
    select id from store_orders
    where files_deleted_at is null
      and ((status in ('delivered', 'cancelled') and updated_at < now() - interval '7 days')
        or (status = 'expired' and updated_at < now() - interval '1 day'))
    order by id limit 50`;
  for (const row of done) {
    try {
      const items = await sql`select pathname from store_order_items where order_id = ${row.id}`;
      const paths = items.map((i) => String(i.pathname));
      if (paths.length) await del(paths);
      await sql`update store_orders set files_deleted_at = now() where id = ${row.id}`;
    } catch (error) {
      console.error("store cleanup", row.id, error);
    }
  }
  if (!deep) return;
  // Uploads older than a day that no order points to.
  const dayAgo = Date.now() - 24 * 3_600_000;
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await list({ prefix: "loja/", cursor, limit: 500 });
    const old = page.blobs.filter((b) => new Date(b.uploadedAt).getTime() < dayAgo).map((b) => b.pathname);
    if (old.length) {
      const used = await sql`select pathname from store_order_items where pathname = any(${old}::text[])`;
      const keep = new Set(used.map((u) => String(u.pathname)));
      const orphans = old.filter((p) => !keep.has(p));
      if (orphans.length) await del(orphans);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && ++pages < 20);
}
