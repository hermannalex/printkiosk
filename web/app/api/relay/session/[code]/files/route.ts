import { preflight, withCors } from "@/lib/kiosk-cors";
import { authorizedRelaySession, listRelayFiles, relayAuthorizedOnly } from "@/lib/relay";

export const dynamic = "force-dynamic";

/** The kiosk asks every few seconds which files have arrived. */
async function innerGET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await authorizedRelaySession(request, code);
  if (!session) return relayAuthorizedOnly();
  const files = await listRelayFiles(code);
  return Response.json(
    { files, expiresAt: session.expiresAt.toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  return withCors(request, await innerGET(request, ctx));
}

export function OPTIONS(request: Request) {
  return preflight(request);
}
