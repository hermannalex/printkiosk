import { authorizedRelaySession, listRelayFiles, relayAuthorizedOnly } from "@/lib/relay";

export const dynamic = "force-dynamic";

/** The kiosk asks every few seconds which files have arrived. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await authorizedRelaySession(request, code);
  if (!session) return relayAuthorizedOnly();
  const files = await listRelayFiles(code);
  return Response.json(
    { files, expiresAt: session.expiresAt.toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
