import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { googleEnabled, startGoogle } from "@/lib/google";
import { clientIp, rateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-pk_oauth" : "pk_oauth";

export async function GET(request: Request) {
  const intent = new URL(request.url).searchParams.get("de") === "cadastro" ? "cadastro" : "entrar";
  if (!googleEnabled()) redirect(`/${intent}?erro=${encodeURIComponent("Entrar com Google ainda não está disponível.")}`);
  if (!(await rateLimit(`google:ip:${await clientIp()}`, 30, 15 * 60))) {
    redirect(`/${intent}?erro=${encodeURIComponent("Muitas tentativas. Aguarde alguns minutos.")}`);
  }
  const start = startGoogle(intent);
  (await cookies()).set(COOKIE, start.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // sent back on Google's top-level redirect to the callback
    path: "/",
    maxAge: 600,
  });
  redirect(start.url);
}
