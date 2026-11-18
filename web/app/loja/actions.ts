"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { PASSWORD_MAX, burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/auth";
import { one, sql } from "@/lib/db";
import { emailConfigured, sendEmail } from "@/lib/email";
import { clientIp, rateLimit } from "@/lib/security";
import { CUSTOMER_PASSWORD_MIN, PUBLIC_URL, openStore } from "@/lib/store";
import { endCustomerSession, startCustomerSession } from "@/lib/store-auth";
import { simpleEmail } from "@/lib/store-pix";

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

// ---------------------------------------------------------------- forgot password

const RESET_MINUTES = 60;
const resetHash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Sends a one-time link to set a new password. The answer is the same whether or not the e-mail
 * has an account, so the form can't be used to find out who is a customer.
 */
export async function customerForgot(form: FormData) {
  const slug = text(form, "loja", 40);
  const store = await openStore(slug);
  if (!store) redirect(`/loja/${encodeURIComponent(slug)}`);
  const email = text(form, "email", 254).toLowerCase();
  const done = `/loja/${slug}/esqueci?enviado=1`;
  if (!EMAIL_RE.test(email)) back(slug, "esqueci", "Digite um e-mail válido.");
  const ip = await clientIp();
  if (!(await rateLimit(`loja-esqueci:ip:${ip}`, 10, 3600)) || !(await rateLimit(`loja-esqueci:${store!.id}:${email}`, 3, 3600))) {
    back(slug, "esqueci", TOO_MANY);
  }
  const customer = await one`select id, name from store_customers where store_id = ${store!.id} and email = ${email}`;
  if (customer && emailConfigured()) {
    const token = randomBytes(32).toString("base64url");
    await sql`delete from customer_password_resets where expires_at < now() - interval '1 day'`;
    await sql`update customer_password_resets set used_at = now() where customer_id = ${customer.id} and used_at is null`;
    await sql`insert into customer_password_resets (token_hash, customer_id, expires_at)
              values (${resetHash(token)}, ${customer.id}, now() + make_interval(mins => ${RESET_MINUTES}))`;
    const first = String(customer.name).split(/\s+/)[0];
    const body = simpleEmail(
      "Criar uma nova senha",
      [
        `Olá, ${first}! Recebemos um pedido para trocar a senha do seu cadastro na ${store!.name}.`,
        `O link vale por ${RESET_MINUTES} minutos e só pode ser usado uma vez.`,
        "Se não foi você, ignore este e-mail: sua senha continua a mesma.",
      ],
      { href: `${PUBLIC_URL}/loja/${store!.slug}/nova-senha?t=${token}`, label: "Criar nova senha" },
    );
    try {
      await sendEmail({ to: email, subject: `Nova senha · ${store!.name}`, ...body });
    } catch (error) {
      console.error("store reset e-mail", error);
    }
  }
  redirect(done);
}

export async function customerResetPassword(form: FormData) {
  const slug = text(form, "loja", 40);
  const store = await openStore(slug);
  if (!store) redirect(`/loja/${encodeURIComponent(slug)}`);
  const token = text(form, "t", 100);
  const password = String(form.get("senha") ?? "");
  const again = String(form.get("senha2") ?? "");
  const keep = `&t=${encodeURIComponent(token)}`;
  if (!(await rateLimit(`loja-nova-senha:${await clientIp()}`, 20, 3600))) back(slug, "nova-senha", TOO_MANY, keep);
  if (password.length < CUSTOMER_PASSWORD_MIN || password.length > PASSWORD_MAX) {
    back(slug, "nova-senha", `A senha precisa ter pelo menos ${CUSTOMER_PASSWORD_MIN} caracteres.`, keep);
  }
  if (password !== again) back(slug, "nova-senha", "As duas senhas não são iguais.", keep);
  const row = await one`
    update customer_password_resets r set used_at = now()
    from store_customers c
    where r.token_hash = ${resetHash(token)} and r.used_at is null and r.expires_at > now()
      and c.id = r.customer_id and c.store_id = ${store!.id}
    returning r.customer_id`;
  if (!row) back(slug, "esqueci", "Este link expirou ou já foi usado. Peça um novo.");
  const customerId = Number(row!.customer_id);
  await sql`update store_customers set password_hash = ${hashPassword(password)} where id = ${customerId}`;
  await sql`delete from customer_sessions where customer_id = ${customerId}`; // signs out every other device
  await startCustomerSession(customerId);
  redirect(`/loja/${store!.slug}/pedidos?msg=${encodeURIComponent("Senha trocada. Você já está conectado.")}`);
}
