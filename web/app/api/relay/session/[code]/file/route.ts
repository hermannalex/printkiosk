import { preflight, withCors } from "@/lib/kiosk-cors";
import { del, get } from "@vercel/blob";
import { authorizedRelaySession, relayAuthorizedOnly, relayPrefix } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function target(request: Request, code: string) {
  const session = await authorizedRelaySession(request, code);
  if (!session) return null;
  const pathname = new URL(request.url).searchParams.get("p") ?? "";
  if (!pathname.startsWith(relayPrefix(code)) || pathname.includes("..")) return null;
  return pathname;
}

/** The kiosk downloads one file (?p=<pathname>). */
async function innerGET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const pathname = await target(request, code);
  if (!pathname) return relayAuthorizedOnly();
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return Response.json({ error: "Arquivo não encontrado." }, { status: 404 });
  }
  return new Response(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** The kiosk deletes a file right after it is saved on the device. */
async function innerDELETE(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const pathname = await target(request, code);
  if (!pathname) return relayAuthorizedOnly();
  await del(pathname);
  return Response.json({ ok: true });
}

export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  return withCors(request, await innerGET(request, ctx));
}

export async function DELETE(request: Request, ctx: { params: Promise<{ code: string }> }) {
  return withCors(request, await innerDELETE(request, ctx));
}

export function OPTIONS(request: Request) {
  return preflight(request);
}
