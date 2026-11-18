"use server";

import { redirect } from "next/navigation";
import { PASSWORD_MAX, burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/auth";
import { one } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/security";
import { CUSTOMER_PASSWORD_MIN, openStore } from "@/lib/store";
import { endCustomerSession, startCustomerSession } from "@/lib/store-auth";

const text = (form: FormData, key: string, max = 200) => String(form.get(key) ?? "").trim().slice(0, max);
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;
const TOO_MANY = "Muitas tentativas. Aguarde alguns minutos e tente de novo.";

function back(slug: string, page: string, error: string, extra = ""): never {
  redirect(`/loja/${slug}/${page}?erro=${encodeURIComponent(error)}${extra}`);
}

/** Only paths inside this store, so a link can't send the customer elsewhere after signing in. */
function nextPath(slug: string, value: string): string {
  const base = `/loja/${slug}`;
  return value.startsWith(`${base}/`) && !value.includes("//") && /^[\w\-/]+$/.test(value) ? value : `${base}/pedido/novo`;
}

export async function customerSignup(form: FormData) {
  const slug = text(form, "loja", 40);
  const store = await openStore(slug);
  if (!store) redirect(`/loja/${encodeURIComponent(slug)}`);
  const name = text(form, "nome", 80).replace(/[\u0000-\u001f<>]/g, "");
  const email = text(form, "email", 254).toLowerCase();
  const password = String(form.get("senha") ?? "");
  const next = nextPath(slug, text(form, "next", 120));
  const keep = `&next=${encodeURIComponent(next)}`;

  if (!(await rateLimit(`loja-cadastro:${await clientIp()}`, 10, 3600))) back(slug, "cadastro", TOO_MANY, keep);
  if (name.length < 2) back(slug, "cadastro", "Digite seu nome.", keep);
  if (!EMAIL_RE.test(email)) back(slug, "cadastro", "Digite um e-mail válido.", keep);
  if (password.length < CUSTOMER_PASSWORD_MIN || password.length > PASSWORD_MAX) {
    back(slug, "cadastro", `A senha precisa ter pelo menos ${CUSTOMER_PASSWORD_MIN} caracteres.`, keep);
  }
  const exists = await one`select 1 from store_customers where store_id = ${store!.id} and email = ${email}`;
  if (exists) back(slug, "entrar", "Este e-mail já tem cadastro nesta loja. Entre com sua senha.", keep);

  const row = await one`
    insert into store_customers (store_id, name, email, password_hash)
    values (${store!.id}, ${name}, ${email}, ${hashPassword(password)})
    on conflict (store_id, email) do nothing returning id`;
  if (!row) back(slug, "entrar", "Este e-mail já tem cadastro nesta loja. Entre com sua senha.", keep);
  await startCustomerSession(Number(row!.id));
  redirect(next);
}

export async function customerLogin(form: FormData) {
  const slug = text(form, "loja", 40);
  const store = await openStore(slug);
  if (!store) redirect(`/loja/${encodeURIComponent(slug)}`);
  const email = text(form, "email", 254).toLowerCase();
  const password = String(form.get("senha") ?? "").slice(0, PASSWORD_MAX);
  const next = nextPath(slug, text(form, "next", 120));
  const keep = `&next=${encodeURIComponent(next)}`;
  const ip = await clientIp();

  if (!(await rateLimit(`loja-login:ip:${ip}`, 30, 900)) || !(await rateLimit(`loja-login:${store!.id}:${email}`, 8, 900))) {
    back(slug, "entrar", TOO_MANY, keep);
  }
  const row = await one`select id, password_hash from store_customers where store_id = ${store!.id} and email = ${email}`;
  if (!row) burnPasswordCheck(password);
  if (!row || !verifyPassword(password, row.password_hash)) back(slug, "entrar", "E-mail ou senha incorretos.", keep);
  await startCustomerSession(Number(row!.id));
  redirect(next);
}

export async function customerLogout(form: FormData) {
  const slug = text(form, "loja", 40);
  await endCustomerSession();
  redirect(`/loja/${encodeURIComponent(slug)}`);
}
