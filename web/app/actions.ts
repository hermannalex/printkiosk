"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  burnPasswordCheck,
  endSession,
  hashPassword,
  needsRehash,
  requireMaster,
  requireUser,
  revokeSessions,
  startChallenge,
  startSession,
  verifyPassword,
} from "@/lib/auth";
import { one, sql } from "@/lib/db";
import { brl, parseBRL, todayIso } from "@/lib/format";
import { extendKiosk } from "@/lib/kiosks";
import { normalizePairingCode, normalizeStoreCode, pairingCode } from "@/lib/license";
import { cancelPreapproval, createPreapproval, mercadoPagoConfigured } from "@/lib/mercadopago";
import { DEFAULT_CONFIG, sanitizeConfig } from "@/lib/kiosk-config";
import { PLANS, monthlyPrice, type PlanId } from "@/lib/plans";
import { audit, clientIp, rateLimit, safeEqual } from "@/lib/security";

/** Trimmed form value, cut to `max` characters so oversized input never reaches the database. */
const text = (form: FormData, key: string, max = 200) => String(form.get(key) ?? "").trim().slice(0, max);
const go = (path: string, kind: "msg" | "erro", message: string): never =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);

const TOO_MANY = "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;

// ---------------------------------------------------------------- login

export async function login(form: FormData) {
  const email = text(form, "email", 254).toLowerCase();
  const password = String(form.get("senha") ?? "").slice(0, PASSWORD_MAX);
  const ip = await clientIp();

  if (!(await rateLimit(`login:ip:${ip}`, 20, 15 * 60)) || !(await rateLimit(`login:email:${email}`, 8, 15 * 60))) {
    await audit(null, "login_bloqueado", email, `ip ${ip}`);
    go("/entrar", "erro", TOO_MANY);
  }

  const user = await one`select id, password_hash, role, blocked, totp_enabled from users where email = ${email}`;
  if (!user) burnPasswordCheck(password); // same response time whether or not the e-mail exists
  const valid = !!user && verifyPassword(password, user.password_hash);
  if (!user || !valid || user.blocked) {
    await audit(user ? Number(user.id) : null, "login_falhou", email, user?.blocked ? "conta bloqueada" : null);
    go("/entrar", "erro", "E-mail ou senha incorretos.");
  }

  if (needsRehash(user!.password_hash)) {
    await sql`update users set password_hash = ${hashPassword(password)} where id = ${user!.id}`;
  }
  if (user!.totp_enabled) {
    // Password is right; the session only starts after the code from the authenticator app.
    await startChallenge(Number(user!.id));
    await audit(Number(user!.id), "senha_ok", email, "aguardando o segundo fator");
    redirect("/entrar/codigo");
  }
  // No 2FA yet: a session that can only reach the setup page (requireUser enforces it).
  await startSession(Number(user!.id), user!.role);
  await audit(Number(user!.id), "login_sem_2fa", email);
  redirect("/conta/seguranca");
}

export async function register(form: FormData) {
  const name = text(form, "nome", 80);
  const email = text(form, "email", 254).toLowerCase();
  const phone = text(form, "telefone", 30) || null;
  const password = String(form.get("senha") ?? "");
  const setupCode = text(form, "codigo_master", 100);
  const ip = await clientIp();

  if (!(await rateLimit(`register:ip:${ip}`, 5, 60 * 60))) go("/cadastro", "erro", TOO_MANY);
  if (!name || !EMAIL_RE.test(email)) go("/cadastro", "erro", "Preencha nome e um e-mail válido.");
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    go("/cadastro", "erro", `A senha precisa ter de ${PASSWORD_MIN} a ${PASSWORD_MAX} caracteres.`);
  }
  const localPart = email.split("@")[0];
  const lowered = password.toLowerCase();
  if (lowered === email || (localPart.length >= 4 && lowered.includes(localPart)) || /^(.)\1+$/.test(password)) {
    go("/cadastro", "erro", "Escolha uma senha que não repita o seu e-mail nem um único caractere.");
  }

  const masterEmail = (process.env.MASTER_EMAIL ?? "").toLowerCase();
  let role: "owner" | "master" = "owner";
  if (masterEmail && email === masterEmail) {
    const expected = process.env.MASTER_SETUP_CODE ?? "";
    if (!expected || !safeEqual(setupCode, expected)) {
      await audit(null, "cadastro_master_recusado", email, `ip ${ip}`);
      go("/cadastro", "erro", "Este e-mail é reservado.");
    }
    role = "master";
  }

  const existing = await one`select id from users where email = ${email}`;
  if (existing) go("/cadastro", "erro", "Já existe uma conta com este e-mail. Entre com sua senha.");

  const user = await one`insert into users (email, name, phone, password_hash, role)
                         values (${email}, ${name}, ${phone}, ${hashPassword(password)}, ${role}) returning id`;
  await audit(Number(user!.id), role === "master" ? "cadastro_master" : "cadastro", email);
  await startSession(Number(user!.id), role);
  redirect("/conta/seguranca?msg=" + encodeURIComponent("Conta criada. Agora ative a verificação em duas etapas."));
}

export async function logout() {
  await endSession();
  redirect("/entrar");
}

// ---------------------------------------------------------------- owner: kiosks

export async function addKiosk(form: FormData) {
  const user = await requireUser();
  const back = "/painel/quiosques";
  const storeCode = normalizeStoreCode(text(form, "codigo", 20));
  const pairing = normalizePairingCode(text(form, "vinculo", 20));
  const name = text(form, "nome", 60) || "Quiosque";
  if (!(await rateLimit(`pair:user:${user.id}`, 10, 60 * 60))) go(back, "erro", TOO_MANY);
  if (!storeCode) go(back, "erro", "Código da loja inválido. Ele tem 8 letras e números, como ABCD-EFGH.");

  const kiosk = await one`select id, owner_id, secret_hash from kiosks where store_code = ${storeCode}`;
  if (!kiosk?.secret_hash) {
    go(back, "erro", "Este quiosque ainda não se conectou ao painel. Abra o app no aparelho com internet e tente de novo.");
  }
  if (!safeEqual(pairing, pairingCode(kiosk!.secret_hash))) {
    await audit(user.id, "vinculo_recusado", storeCode, null);
    go(back, "erro", "Código de vinculação incorreto. Ele aparece em Configurações › Assinatura, no aparelho.");
  }
  if (kiosk!.owner_id && Number(kiosk!.owner_id) !== user.id) {
    go(back, "erro", "Este quiosque já está ligado a outra conta. Fale com o suporte.");
  }
  await sql`update kiosks set owner_id = ${user.id}, name = ${name} where id = ${kiosk!.id}`;
  await audit(user.id, "quiosque_vinculado", storeCode, name);
  revalidatePath(back);
  go(back, "msg", `Quiosque ${storeCode} adicionado.`);
}

export async function renameKiosk(form: FormData) {
  const user = await requireUser();
  const id = Number(text(form, "id", 20));
  const name = text(form, "nome", 60);
  if (!name) go(`/painel/quiosques/${id}`, "erro", "Informe um nome.");
  await sql`update kiosks set name = ${name} where id = ${id} and (owner_id = ${user.id} or ${user.role === "master"})`;
  revalidatePath(`/painel/quiosques/${id}`);
  go(`/painel/quiosques/${id}`, "msg", "Nome atualizado.");
}

/** The app's settings, sent to the kiosk on its next sync (launch, every 30 min, after each print). */
export async function saveKioskConfig(form: FormData) {
  const user = await requireUser();
  const id = Number(text(form, "id", 20));
  const back = user.role === "master" && text(form, "de", 10) === "master" ? `/master/quiosques/${id}` : `/painel/quiosques/${id}`;
  const cents = parseBRL(text(form, "preco", 20));
  if (cents === null || cents > 5000) go(back, "erro", "Informe o preço por página, de R$ 0,00 a R$ 50,00 (ex.: 0,50).");
  const email = text(form, "email_pagador", 254);
  if (email && !EMAIL_RE.test(email)) go(back, "erro", "E-mail do pagador Pix inválido.");
  const input = {
    kioskName: text(form, "nome_tela", 40),
    pricePerPageCents: cents,
    maxCopies: Number(text(form, "copias", 3)),
    maxItems: Number(text(form, "itens", 3)),
    idleTimeoutSeconds: Number(text(form, "inatividade", 4)),
    paymentTimeoutSeconds: Number(text(form, "tempo_pix", 4)),
    payerEmail: email,
    wifiName: text(form, "wifi", 32),
    wifiPassword: String(form.get("wifi_senha") ?? "").slice(0, 63),
  };
  const config = sanitizeConfig(input);
  const missing = Object.keys(DEFAULT_CONFIG).filter((k) => !(k in config));
  if (missing.length) go(back, "erro", "Confira os campos: algum valor está fora do permitido.");

  const row = await one`update kiosks set config = ${JSON.stringify(config)}::jsonb, config_version = config_version + 1
                        where id = ${id} and (owner_id = ${user.id} or ${user.role === "master"})
                        returning store_code`;
  if (!row) go(back, "erro", "Quiosque não encontrado.");
  await audit(user.id, "config_alterada", row!.store_code, `${brl(config.pricePerPageCents!)} por página, até ${config.maxCopies} cópias`);
  revalidatePath(back);
  go(back, "msg", "Configurações salvas. O quiosque aplica na próxima conexão (em até 30 minutos, ou ao abrir o app).");
}

export async function subscribe(form: FormData) {
  const user = await requireUser();
  const kioskId = Number(text(form, "id", 20));
  const plan = (text(form, "plano", 10) === "pro" ? "pro" : "basic") as PlanId;
  const back = `/painel/quiosques/${kioskId}`;

  const kiosk = await one`select id, name, store_code from kiosks where id = ${kioskId} and owner_id = ${user.id}`;
  if (!kiosk) go("/painel/quiosques", "erro", "Quiosque não encontrado.");
  if (!mercadoPagoConfigured()) {
    go(back, "erro", "O pagamento online ainda não está disponível. Fale com o suporte para ativar sua assinatura.");
  }
  if (!(await rateLimit(`subscribe:user:${user.id}`, 10, 60 * 60))) go(back, "erro", TOO_MANY);

  const { cents: amount, extra } = await monthlyPrice(plan, user.id, kioskId);
  const subscription = await one`insert into subscriptions (kiosk_id, owner_id, plan, amount_cents)
                                 values (${kioskId}, ${user.id}, ${plan}, ${amount}) returning id`;
  const appUrl = process.env.APP_URL ?? "";
  let initPoint = "";
  try {
    const preapproval = await createPreapproval({
      reason: `Quioco ${PLANS[plan].name}${extra ? " (quiosque adicional)" : ""} – ${kiosk!.name} (${kiosk!.store_code})`,
      externalReference: String(subscription!.id),
      payerEmail: user.email,
      amountCents: amount,
      backUrl: `${appUrl}${back}?msg=${encodeURIComponent("Assinatura recebida. O quiosque é liberado assim que o Mercado Pago confirmar o pagamento.")}`,
    });
    await sql`update subscriptions set mp_preapproval_id = ${preapproval.id}, init_point = ${preapproval.init_point},
                updated_at = now() where id = ${subscription!.id}`;
    initPoint = preapproval.init_point;
  } catch (error) {
    console.error("subscribe", kioskId, error);
  }
  // Only ever send the browser to Mercado Pago's own checkout.
  if (!/^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.br)?\//.test(initPoint)) {
    go(back, "erro", "Não foi possível abrir o pagamento agora. Tente de novo em alguns minutos.");
  }
  await audit(user.id, "assinatura_iniciada", kiosk!.store_code, PLANS[plan].name);
  redirect(initPoint);
}

export async function cancelSubscription(form: FormData) {
  const user = await requireUser();
  const id = Number(text(form, "assinatura", 20));
  const sub = await one`select id, kiosk_id, mp_preapproval_id from subscriptions
                        where id = ${id} and (owner_id = ${user.id} or ${user.role === "master"})`;
  if (!sub) go("/painel/quiosques", "erro", "Assinatura não encontrada.");
  let failed = false;
  try {
    if (sub!.mp_preapproval_id) await cancelPreapproval(sub!.mp_preapproval_id);
  } catch (error) {
    console.error("cancelSubscription", id, error);
    failed = true;
  }
  if (failed) go(`/painel/quiosques/${sub!.kiosk_id}`, "erro", "Não foi possível cancelar agora. Tente de novo em alguns minutos.");
  await sql`update subscriptions set status = 'cancelled', updated_at = now() where id = ${id}`;
  await audit(user.id, "assinatura_cancelada", String(sub!.kiosk_id), String(id));
  go(`/painel/quiosques/${sub!.kiosk_id}`, "msg", "Assinatura cancelada. O quiosque continua liberado até o fim do período pago.");
}

// ---------------------------------------------------------------- master

export async function masterGenerateCode(form: FormData) {
  const master = await requireMaster();
  const kioskId = Number(text(form, "id", 20));
  const until = text(form, "ate", 10);
  const back = `/master/quiosques/${kioskId}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < todayIso()) go(back, "erro", "Escolha uma data a partir de hoje.");
  let message = "";
  try {
    const result = await extendKiosk(kioskId, { untilIso: until, source: "manual", byUserId: master.id });
    message = `Código gerado, válido até ${result.validUntil.split("-").reverse().join("/")}. O quiosque recebe sozinho na próxima conexão.`;
  } catch (error) {
    console.error("masterGenerateCode", kioskId, error);
    go(back, "erro", "Não foi possível gerar o código.");
  }
  await audit(master.id, "codigo_gerado", String(kioskId), `até ${until}`);
  revalidatePath(back);
  go(back, "msg", message);
}

export async function masterManualPayment(form: FormData) {
  const master = await requireMaster();
  const kioskId = Number(text(form, "id", 20));
  const months = Math.max(1, Math.min(12, Number(text(form, "meses", 3)) || 1));
  const back = `/master/quiosques/${kioskId}`;
  const kiosk = await one`select id, owner_id, plan from kiosks where id = ${kioskId}`;
  if (!kiosk) go("/master/quiosques", "erro", "Quiosque não encontrado.");
  const plan = (kiosk!.plan === "pro" ? "pro" : "basic") as PlanId;
  const amount = (await monthlyPrice(plan, kiosk!.owner_id ? Number(kiosk!.owner_id) : null, kioskId)).cents * months;
  const result = await extendKiosk(kioskId, { months, source: "manual", byUserId: master.id });
  await sql`insert into payments (kiosk_id, owner_id, amount_cents, status, note)
            values (${kioskId}, ${kiosk!.owner_id}, ${amount}, 'manual', ${`Pagamento manual de ${months} mês(es)`})`;
  await audit(master.id, "pagamento_manual", String(kioskId), `${months} mês(es)`);
  revalidatePath(back);
  go(back, "msg", `Pagamento registrado. Liberado até ${result.validUntil.split("-").reverse().join("/")}.`);
}

export async function masterSetPlan(form: FormData) {
  const master = await requireMaster();
  const kioskId = Number(text(form, "id", 20));
  const plan = text(form, "plano", 10) === "pro" ? "pro" : "basic";
  await sql`update kiosks set plan = ${plan} where id = ${kioskId}`;
  await audit(master.id, "plano_alterado", String(kioskId), plan);
  revalidatePath(`/master/quiosques/${kioskId}`);
  go(`/master/quiosques/${kioskId}`, "msg", `Plano alterado para ${PLANS[plan].name}.`);
}

export async function masterAssignOwner(form: FormData) {
  const master = await requireMaster();
  const kioskId = Number(text(form, "id", 20));
  const email = text(form, "email", 254).toLowerCase();
  const back = `/master/quiosques/${kioskId}`;
  const owner = await one`select id from users where email = ${email}`;
  if (!owner) go(back, "erro", "Nenhuma conta com este e-mail.");
  await sql`update kiosks set owner_id = ${owner!.id} where id = ${kioskId}`;
  await audit(master.id, "dono_alterado", String(kioskId), email);
  revalidatePath(back);
  go(back, "msg", "Dono do quiosque atualizado.");
}

export async function masterToggleBlock(form: FormData) {
  const master = await requireMaster();
  const userId = Number(text(form, "id", 20));
  if (userId === master.id) go("/master/lojas", "erro", "Você não pode bloquear a própria conta.");
  const row = await one`update users set blocked = not blocked where id = ${userId} returning blocked, email`;
  if (row?.blocked) await revokeSessions(userId); // a blocked account is logged out everywhere at once
  await audit(master.id, row?.blocked ? "conta_bloqueada" : "conta_desbloqueada", row?.email ?? String(userId));
  revalidatePath("/master/lojas");
  go("/master/lojas", "msg", "Acesso atualizado.");
}
