import { authorizedRelaySession, closeRelaySession, relayAuthorizedOnly } from "@/lib/relay";

export const dynamic = "force-dynamic";

/** The kiosk ends the session (back to start, panel closed): its files are deleted at once. */
export async function DELETE(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await authorizedRelaySession(request, code);
  if (!session) return relayAuthorizedOnly();
  await closeRelaySession(code);
  return Response.json({ ok: true });
}
