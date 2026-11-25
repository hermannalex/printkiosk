import { preflight, withCors } from "@/lib/kiosk-cors";
import { authorizedRelaySession, closeRelaySession, relayAuthorizedOnly } from "@/lib/relay";

export const dynamic = "force-dynamic";

/** The kiosk ends the session (back to start, panel closed): its files are deleted at once. */
async function innerDELETE(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await authorizedRelaySession(request, code);
  if (!session) return relayAuthorizedOnly();
  await closeRelaySession(code);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ code: string }> }) {
  return withCors(request, await innerDELETE(request, ctx));
}

export function OPTIONS(request: Request) {
  return preflight(request);
}
