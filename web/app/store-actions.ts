"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { one, sql } from "@/lib/db";
import { parseBRL } from "@/lib/format";
import { ownerHasEnterprise } from "@/lib/kiosks";
import { audit, rateLimit } from "@/lib/security";
import { isOrderCode, sealToken, slugProblem, slugify, storeOfOwner } from "@/lib/store";
import { checkStoreToken, cleanToken, notifyReady } from "@/lib/store-pix";
import { MAX_PRICE_CENTS, enabledSizes, sanitizeStoreConfig, slugId, type ExtraUnit, type StoreExtra, type StoreSize } from "@/lib/store-price";

const text = (form: FormData, key: string, max = 200) => String(form.get(key) ?? "").trim().slice(0, max);
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;
const PAGE = "/painel/loja";

function go(kind: "msg" | "erro", message: string, path = PAGE): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

/** The owner's store, created with defaults the first time. */
async function ensureStore(ownerId: number, ownerName: string) {
  const existing = await storeOfOwner(ownerId);
  if (existing) return existing;
  let slug = slugify(ownerName) || "loja";
  if (slug.length < 3) slug = `loja-${slug}`;
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? slug : `${slug.slice(0, 34)}-${i + 1}`;
    if (slugProblem(candidate)) continue;
    const row = await one`insert into stores (owner_id, slug, name) values (${ownerId}, ${candidate}, ${ownerName.slice(0, 60) || "Minha loja"})
                          on conflict do nothing returning id`;
    if (row) return (await storeOfOwner(ownerId))!;
  }
  throw new Error("Não foi possível criar a loja.");
}

export async function createStore() {
  const user = await requireUser();
  await ensureStore(user.id, user.name);
  go("msg", "Loja criada. Configure os preços, o Pix e publique.");
}

export async function saveStoreBasics(form: FormData) {
  const user = await requireUser();
  const store = await ensureStore(user.id, user.name);
  const name = text(form, "nome", 60).replace(/[\u0000-\u001f<>]/g, "");
  const slug = text(form, "endereco", 40).toLowerCase();
  const pickup = text(form, "retirada", 500).replace(/[\u0000-\u0008\u000b-\u001f<>]/g, "");
  const notify = text(form, "aviso", 254).toLowerCase();
  const publish = form.get("publicada") === "on";

  if (name.length < 2) go("erro", "Digite o nome da loja.");
  const problem = slugProblem(slug);
  if (problem) go("erro", problem);
  if (notify && !EMAIL_RE.test(notify)) go("erro", "E-mail de aviso inválido.");
  const taken = await one`select 1 from stores where slug = ${slug} and id <> ${store.id}`;
  if (taken) go("erro", "Este endereço já é usado por outra loja. Escolha outro.");
  if (publish) {
    if (!(await ownerHasEnterprise(user.id))) go("erro", "Para publicar, assine o plano Enterprise em um dos seus quiosques.");
    if (!store.hasToken) go("erro", "Para publicar, cadastre antes o Access Token do Mercado Pago (recebimento por Pix).");
    if (enabledSizes(store.config).length === 0) go("erro", "Para publicar, ative pelo menos um formato com preço.");
  }
  await sql`update stores set name = ${name}, slug = ${slug}, pickup_info = ${pickup}, notify_email = ${notify || null},
                              published = ${publish}, updated_at = now()
            where id = ${store.id}`;
  await audit(user.id, "loja_salva", slug, publish ? "publicada" : "não publicada");
  go("msg", publish ? "Loja salva e publicada." : "Loja salva.");
}

export async function saveStoreToken(form: FormData) {
  const user = await requireUser();
  const store = await ensureStore(user.id, user.name);
  if (!(await rateLimit(`loja-token:${user.id}`, 10, 3600))) go("erro", "Muitas tentativas. Aguarde alguns minutos.");
  const token = cleanToken(String(form.get("token") ?? "").slice(0, 300));
  if (!/^(APP_USR|TEST)-[\w-]{20,}$/.test(token)) {
    go("erro", "Isso não parece um Access Token do Mercado Pago. Ele começa com APP_USR-. Veja o passo a passo.");
  }
  if (token.startsWith("TEST-")) go("erro", "Use o Access Token de produção (APP_USR-), não o de teste.");
  let account = "";
  try {
    account = await checkStoreToken(token);
  } catch (error) {
    go("erro", `O Mercado Pago recusou este token. Confira se copiou o Access Token de produção inteiro. (${error instanceof Error ? error.message : ""})`);
  }
  await sql`update stores set mp_token_enc = ${sealToken(token)}, mp_token_tail = ${token.slice(-4)}, updated_at = now() where id = ${store.id}`;
  await audit(user.id, "loja_token_salvo", store.slug, `final ${token.slice(-4)}`);
  go("msg", `Token salvo e conferido: conta ${account}. Os Pix dos pedidos caem direto nela.`);
}

export async function removeStoreToken() {
  const user = await requireUser();
  const store = await storeOfOwner(user.id);
  if (store) {
    await sql`update stores set mp_token_enc = null, mp_token_tail = null, published = false, updated_at = now() where id = ${store.id}`;
    await audit(user.id, "loja_token_removido", store.slug, null);
  }
  go("msg", "Token removido. A loja saiu do ar até um novo token ser cadastrado.");
}

export async function saveStorePrices(form: FormData) {
  const user = await requireUser();
  const store = await ensureStore(user.id, user.name);
  const money = (key: string, label: string): number | null => {
    const raw = text(form, key, 12);
    if (!raw) return null;
    const value = parseBRL(raw);
    if (value === null || value > MAX_PRICE_CENTS) go("erro", `Preço inválido em "${label}". Use o formato 0,50.`);
    return value;
  };

  const sizes: StoreSize[] = [];
  for (let i = 0; i < 24; i++) {
    const name = text(form, `size_name_${i}`, 40);
    if (!name) continue;
    const pb = money(`size_pb_${i}`, name);
    const color = money(`size_color_${i}`, name);
    if (pb === null && color === null) go("erro", `Dê um preço em preto e branco ou colorido para "${name}".`);
    sizes.push({ id: text(form, `size_id_${i}`, 30) || slugId(name), name, enabled: form.get(`size_on_${i}`) === "on", pb, color });
  }
  const extras: StoreExtra[] = [];
  for (let i = 0; i < 24; i++) {
    const name = text(form, `extra_name_${i}`, 40);
    if (!name) continue;
    const cents = money(`extra_cents_${i}`, name) ?? 0;
    const unitRaw = text(form, `extra_unit_${i}`, 8);
    const unit: ExtraUnit = unitRaw === "copy" || unitRaw === "file" ? unitRaw : "page";
    extras.push({ id: text(form, `extra_id_${i}`, 30) || slugId(name), name, enabled: form.get(`extra_on_${i}`) === "on", cents, unit });
  }
  const config = sanitizeStoreConfig({ sizes, extras });
  if (store.published && enabledSizes(config).length === 0) go("erro", "A loja está publicada: deixe pelo menos um formato ativo.");
  await sql`update stores set config = ${JSON.stringify(config)}::jsonb, updated_at = now() where id = ${store.id}`;
  await audit(user.id, "loja_precos", store.slug, `${config.sizes.length} formatos, ${config.extras.length} adicionais`);
  go("msg", "Preços salvos.");
}

const NEXT_STATUS: Record<string, string[]> = {
  paid: ["printing", "ready", "cancelled"],
  printing: ["ready", "cancelled"],
  ready: ["delivered", "printing"],
  delivered: ["ready"],
};

export async function setOrderStatus(form: FormData) {
  const user = await requireUser();
  const code = text(form, "pedido", 6);
  const status = text(form, "status", 20);
  const path = `/painel/loja/pedidos/${code}`;
  if (!isOrderCode(code)) go("erro", "Pedido inválido.", "/painel/loja/pedidos");
  const order = await one`select o.id, o.status from store_orders o join stores s on s.id = o.store_id
                          where o.code = ${code} and s.owner_id = ${user.id}`;
  if (!order) go("erro", "Pedido não encontrado.", "/painel/loja/pedidos");
  if (!(NEXT_STATUS[order!.status] ?? []).includes(status)) go("erro", "Esta mudança não é possível agora.", path);
  const updated = await sql`
    update store_orders set status = ${status}, updated_at = now(),
      ready_at = case when ${status} = 'ready' then now() else ready_at end,
      delivered_at = case when ${status} = 'delivered' then now() else delivered_at end
    where id = ${order!.id} and status = ${order!.status} returning id`;
  if (updated.length && status === "ready") await notifyReady(Number(order!.id));
  await audit(user.id, "loja_pedido_status", code, `${order!.status} → ${status}`);
  const messages: Record<string, string> = {
    printing: "Pedido marcado como imprimindo.",
    ready: "Pedido pronto. O cliente recebeu um e-mail.",
    delivered: "Pedido entregue.",
    cancelled: "Pedido cancelado. Se já foi pago, devolva o valor pelo app do Mercado Pago.",
  };
  go("msg", messages[status] ?? "Pedido atualizado.", path);
}
