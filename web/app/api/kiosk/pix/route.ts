import { reply, preflight } from "@/lib/kiosk-cors";
import { authKiosk } from "@/lib/kiosk-auth";
import { PixError, cancelPix, consumePix, createKioskPix, pixStatus } from "@/lib/kiosk-pix";
import { ipFromHeaders, rateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return preflight(request);
}

/**
 * Pix charges for the web station. Body: { storeCode, secret, action, ... } with action
 * "create" (sheets), "status" (id), "cancel" (id) or "consume" (id, when the print starts).
 */
export async function POST(request: Request) {
  const ip = ipFromHeaders(request.headers);
  if (!(await rateLimit(`kpix:ip:${ip}`, 3000, 3600))) return reply(request, { error: "Muitas requisições." }, 429);
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return reply(request, { error: "Envio grande demais." }, 413);

  const body = await request.json().catch(() => null);
  const kiosk = await authKiosk(body);
  if (!kiosk) return reply(request, { error: "Estação não reconhecida." }, 403);
  const action = String(body?.action ?? "");
  if (!(await rateLimit(`kpix:kiosk:${kiosk.id}:${action === "create" ? "create" : "other"}`, action === "create" ? 60 : 1500, 3600))) {
    return reply(request, { error: "Muitas requisições. Aguarde um pouco." }, 429);
  }

  try {
    if (action === "create") return reply(request, await createKioskPix(kiosk, body?.sheets));
    if (action === "status") return reply(request, await pixStatus(kiosk, body?.id));
    if (action === "cancel") return reply(request, await cancelPix(kiosk, body?.id));
    if (action === "consume") return reply(request, await consumePix(kiosk, body?.id));
    return reply(request, { error: "Ação inválida." }, 400);
  } catch (error) {
    if (error instanceof PixError) return reply(request, { error: error.message }, error.status);
    console.error("kiosk pix", action, error);
    return reply(request, { error: "Erro inesperado. Tente de novo." }, 500);
  }
}
