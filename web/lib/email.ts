/** Transactional e-mail through Resend's HTTP API (no SDK: one fetch is all it takes). */

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "imprime.ai <seguranca@imprime.ai>";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export type Email = { to: string; subject: string; html: string; text: string; idempotencyKey?: string };

/** Sends one e-mail. Throws with Resend's message when it is refused, so callers can log it. */
export async function sendEmail(email: Email): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY não configurada.");
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend ${response.status}: ${detail.slice(0, 300)}`);
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The verification-code message: big code, how long it lasts, what to do if it was not you. */
export function codeEmail(code: string, purpose: "login" | "setup", name: string): Omit<Email, "to"> {
  const first = escapeHtml((name || "").split(/\s+/)[0] || "");
  const action = purpose === "login" ? "entrar no painel" : "confirmar a verificação por e-mail";
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const subject = `${spaced} é o seu código do imprime.ai`;
  const text = [
    `Olá${first ? `, ${first}` : ""}.`,
    ``,
    `Seu código para ${action} no imprime.ai é: ${spaced}`,
    ``,
    `Ele vale por 10 minutos e só pode ser usado uma vez.`,
    `Se não foi você, ignore este e-mail e troque sua senha: alguém pode saber a sua senha atual.`,
  ].join("\n");
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f4f8;padding:24px 12px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#15142b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#4F46E5;padding:20px 28px;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px">imprime<span style="color:#FACC15">.ai</span></td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 12px;font-size:16px">Olá${first ? `, ${first}` : ""}.</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5">Use este código para ${action}:</p>
<p style="margin:0 0 20px;text-align:center"><span style="display:inline-block;background:#ECEBFE;color:#312E81;border-radius:12px;padding:14px 22px;font:700 34px/1 Consolas,Menlo,monospace;letter-spacing:6px">${spaced}</span></p>
<p style="margin:0 0 8px;font-size:14px;color:#5a5a73;line-height:1.5">Ele vale por <b>10 minutos</b> e só pode ser usado uma vez. Ninguém do imprime.ai vai pedir este código.</p>
<p style="margin:0;font-size:14px;color:#5a5a73;line-height:1.5">Se não foi você, ignore este e-mail e troque sua senha: alguém pode saber a sua senha atual.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}

/** "al***@gmail.com": enough to recognise the inbox without showing the whole address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const shown = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${shown}***@${domain}`;
}
