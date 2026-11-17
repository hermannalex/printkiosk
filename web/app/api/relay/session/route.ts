import { cleanupRelay, createRelaySession } from "@/lib/relay";
import { ipFromHeaders, rateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";

/** The kiosk opens a session for "Do celular". Body: {"kioskName": "..."}. No account needed (imprime-free too). */
export async function POST(request: Request) {
  const ip = ipFromHeaders(request.headers);
  if (!(await rateLimit(`relay:${ip}`, 120, 3600))) {
    return Response.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
  }
  let kioskName = "";
  try {
    const body = await request.json();
    kioskName = typeof body?.kioskName === "string" ? body.kioskName : "";
  } catch {
    // No body: the kiosk has no name.
  }
  const session = await createRelaySession(kioskName);
  if (Math.random() < 0.25) {
    cleanupRelay().catch((error) => console.error("relay cleanup", error));
  }
  return Response.json(session, { headers: { "Cache-Control": "no-store" } });
}
