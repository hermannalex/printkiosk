"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { endSession, hashPassword, requireMaster, requireUser, startSession, verifyPassword } from "@/lib/auth";
import { one, sql } from "@/lib/db";
import { todayIso } from "@/lib/format";
import { extendKiosk } from "@/lib/kiosks";
import { normalizeStoreCode } from "@/lib/license";
import { cancelPreapproval, createPreapproval, mercadoPagoConfigured } from "@/lib/mercadopago";
import { PLANS, type PlanId } from "@/lib/plans";

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const go = (path: string, kind: "msg" | "erro", message: string): never =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);

// ---------------------------------------------------------------- login

export async function login(form: FormData) {
  const email = text(form, "email").toLowerCase();
  const password = text(form, "senha");
  const user = await one`select id, password_hash, role, blocked from users where email = ${email}`;
  if (!user || user.blocked || !verifyPassword(password, user.password_hash)) {
    go("/entrar", "erro", "E-mail ou senha incorretos.");
  }
  await startSession(Number(user!.id));
  redirect(user!.role === "master" ? "/master" : "/painel");
}

export async function register(form: FormData) {
  const name = text(form, "nome");
  const email = text(form, "email").toLowerCase();
  const phone = text(form, "telefone") || null;
  const password = text(form, "senha");
  const setupCode = text(form, "codigo_master");

  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) go("/cadastro", "erro", "Preencha nome e um e-mail válido.");
  if (password.length < 8) go("/cadastro", "erro", "A senha precisa ter pelo menos 8 caracteres.");

  const masterEmail = (process.env.MASTER_EMAIL ?? "").toLowerCase();
  let role: "owner" | "master" = "owner";
  if (masterEmail && email === masterEmail) {
    if (!process.env.MASTER_SETUP_CODE || setupCode !== process.env.MASTER_SETUP_CODE) {
      go("/cadastro", "erro", "Este e-mail é reservado. Informe o código de configuração do master.");
    }
    role = "master";
  }

  const existing = await one`select id from users where email = ${email}`;
  if (existing) go("/cadastro", "erro", "Já existe uma conta com este e-mail. Entre com sua senha.");

  const user = await one`insert into users (email, name, phone, password_hash, role)
                         values (${email}, ${name}, ${phone}, ${hashPassword(password)}, ${role}) returning id`;
  await startSession(Number(user!.id));
  redirect(role === "master" ? "/master" : "/painel/quiosques?msg=" + encodeURIComponent("Conta criada. Agora adicione o seu quiosque."));
}

export async function logout() {
  await endSession();
  redirect("/entrar");
}

// ---------------------------------------------------------------- owner: kiosks

export async function addKiosk(form: FormData) {
  const user = await requireUser();
  const storeCode = normalizeStoreCode(text(form, "codigo"));
  const name = text(form, "nome") || "Quiosque";
  if (!storeCode) go("/painel/quiosques", "erro", "Código da loja inválido. Ele tem 8 letras e números, como ABCD-EFGH.");

  const kiosk = await one`select id, owner_id from kiosks where store_code = ${storeCode}`;
  if (kiosk && kiosk.owner_id && Number(kiosk.owner_id) !== user.id) {
    go("/painel/quiosques", "erro", "Este quiosque já está ligado a outra conta. Fale com o suporte.");
  }
  if (kiosk) {
    await sql`update kiosks set owner_id = ${user.id}, name = ${name} where id = ${kiosk.id}`;
  } else {
    await sql`insert into kiosks (store_code, owner_id, name) values (${storeCode}, ${user.id}, ${name})`;
  }
  revalidatePath("/painel/quiosques");
  go("/painel/quiosques", "msg", `Quiosque ${storeCode} adicionado.`);
}

export async function renameKiosk(form: FormData) {
  const user = await requireUser();
  const id = Number(text(form, "id"));
  const name = text(form, "nome");
  if (!name) go(`/painel/quiosques/${id}`, "erro", "Informe um nome.");
  await sql`update kiosks set name = ${name} where id = ${id} and (owner_id = ${user.id} or ${user.role === "master"})`;
  revalidatePath(`/painel/quiosques/${id}`);
  go(`/painel/quiosques/${id}`, "msg", "Nome atualizado.");
}

export async function subscribe(form: FormData) {
  const user = await requireUser();
  const kioskId = Number(text(form, "id"));
  const plan = (text(form, "plano") === "pro" ? "pro" : "basic") as PlanId;
  const back = `/painel/quiosques/${kioskId}`;

  const kiosk = await one`select id, name, store_code from kiosks where id = ${kioskId} and owner_id = ${user.id}`;
  if (!kiosk) go("/painel/quiosques", "erro", "Quiosque não encontrado.");
  if (!mercadoPagoConfigured()) {
    go(back, "erro", "O pagamento online ainda não está disponível. Fale com o suporte para ativar sua assinatura.");
  }

  const amount = PLANS[plan].cents;
  const subscription = await one`insert into subscriptions (kiosk_id, owner_id, plan, amount_cents)
                                 values (${kioskId}, ${user.id}, ${plan}, ${amount}) returning id`;
  const appUrl = process.env.APP_URL ?? "";
  let initPoint = "";
  let failure = "";
  try {
    const preapproval = await createPreapproval({
      reason: `PrintKiosk ${PLANS[plan].name} – ${kiosk!.name} (${kiosk!.store_code})`,
      externalReference: String(subscription!.id),
      payerEmail: user.email,
      amountCents: amount,
      backUrl: `${appUrl}${back}?msg=${encodeURIComponent("Assinatura recebida. O quiosque é liberado assim que o Mercado Pago confirmar o pagamento.")}`,
    });
    await sql`update subscriptions set mp_preapproval_id = ${preapproval.id}, init_point = ${preapproval.init_point},
                updated_at = now() where id = ${subscription!.id}`;
    initPoint = preapproval.init_point;
  } catch (error) {
    failure = error instanceof Error ? error.message : "Não foi possível abrir o pagamento.";
  }
  if (failure) go(back, "erro", failure);
  redirect(initPoint);
}

export async function cancelSubscription(form: FormData) {
  const user = await requireUser();
  const id = Number(text(form, "assinatura"));
  const sub = await one`select id, kiosk_id, mp_preapproval_id from subscriptions
                        where id = ${id} and (owner_id = ${user.id} or ${user.role === "master"})`;
  if (!sub) go("/painel/quiosques", "erro", "Assinatura não encontrada.");
  let failure = "";
  try {
    if (sub!.mp_preapproval_id) await cancelPreapproval(sub!.mp_preapproval_id);
  } catch (error) {
    failure = error instanceof Error ? error.message : "Não foi possível cancelar.";
  }
  if (failure) go(`/painel/quiosques/${sub!.kiosk_id}`, "erro", failure);
  await sql`update subscriptions set status = 'cancelled', updated_at = now() where id = ${id}`;
  go(`/painel/quiosques/${sub!.kiosk_id}`, "msg", "Assinatura cancelada. O quiosque continua liberado até o fim do período pago.");
}

// ---------------------------------------------------------------- master

export async function masterGenerateCode(form: FormData) {
  const master = await requireMaster();
  const kioskId = Number(text(form, "id"));
  const until = text(form, "ate");
  const back = `/master/quiosques/${kioskId}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < todayIso()) go(back, "erro", "Escolha uma data a partir de hoje.");
  let message = "";
  try {
    const result = await extendKiosk(kioskId, { untilIso: until, source: "manual", byUserId: master.id });
    message = `Código gerado, válido até ${result.validUntil.split("-").reverse().join("/")}. O quiosque recebe sozinho na próxima conexão.`;
  } catch (error) {
    go(back, "erro", error instanceof Error ? error.message : "Não foi possível gerar o código.");
  }
  revalidatePath(back);
  go(back, "msg", message);
}

export async function masterManualPayment(form: FormData) {
  const master = await requireMaster();
  const kioskId = Number(text(form, "id"));
  const months = Math.max(1, Math.min(12, Number(text(form, "meses")) || 1));
  const back = `/master/quiosques/${kioskId}`;
  const kiosk = await one`select id, owner_id, plan from kiosks where id = ${kioskId}`;
  if (!kiosk) go("/master/quiosques", "erro", "Quiosque não encontrado.");
  const amount = PLANS[(kiosk!.plan as PlanId) ?? "basic"].cents * months;
  const result = await extendKiosk(kioskId, { months, source: "manual", byUserId: master.id });
  await sql`insert into payments (kiosk_id, owner_id, amount_cents, status, note)
            values (${kioskId}, ${kiosk!.owner_id}, ${amount}, 'manual', ${`Pagamento manual de ${months} mês(es)`})`;
  revalidatePath(back);
  go(back, "msg", `Pagamento registrado. Liberado até ${result.validUntil.split("-").reverse().join("/")}.`);
}

export async function masterSetPlan(form: FormData) {
  await requireMaster();
  const kioskId = Number(text(form, "id"));
  const plan = text(form, "plano") === "pro" ? "pro" : "basic";
  await sql`update kiosks set plan = ${plan} where id = ${kioskId}`;
  revalidatePath(`/master/quiosques/${kioskId}`);
  go(`/master/quiosques/${kioskId}`, "msg", `Plano alterado para ${PLANS[plan].name}.`);
}

export async function masterAssignOwner(form: FormData) {
  await requireMaster();
  const kioskId = Number(text(form, "id"));
  const email = text(form, "email").toLowerCase();
  const back = `/master/quiosques/${kioskId}`;
  const owner = await one`select id from users where email = ${email}`;
  if (!owner) go(back, "erro", "Nenhuma conta com este e-mail.");
  await sql`update kiosks set owner_id = ${owner!.id} where id = ${kioskId}`;
  revalidatePath(back);
  go(back, "msg", "Dono do quiosque atualizado.");
}

export async function masterToggleBlock(form: FormData) {
  const master = await requireMaster();
  const userId = Number(text(form, "id"));
  if (userId === master.id) go("/master/lojas", "erro", "Você não pode bloquear a própria conta.");
  await sql`update users set blocked = not blocked where id = ${userId}`;
  revalidatePath("/master/lojas");
  go("/master/lojas", "msg", "Acesso atualizado.");
}
