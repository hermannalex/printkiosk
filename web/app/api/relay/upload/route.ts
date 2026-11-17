import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import {
  listRelayFiles,
  openRelaySession,
  RELAY_MAX_BYTES,
  RELAY_MAX_FILES,
  validRelayPathname,
} from "@/lib/relay";
import { ipFromHeaders, rateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * Gives the customer's phone a short-lived token to upload one file straight to Vercel Blob,
 * only into an open session's folder, only photos and PDFs, at most 50 MB.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  const ip = ipFromHeaders(request.headers);
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!(await rateLimit(`relay-up:${ip}`, 200, 3600))) {
          throw new Error("Muitos envios. Aguarde alguns minutos.");
        }
        const code = String(clientPayload ?? "");
        const session = await openRelaySession(code);
        if (!session) throw new Error("Este link expirou. Leia o QR Code do quiosque de novo.");
        if (!validRelayPathname(code, pathname)) throw new Error("Envio inválido.");
        if ((await listRelayFiles(code)).length >= RELAY_MAX_FILES) {
          throw new Error(`Limite de ${RELAY_MAX_FILES} arquivos por atendimento.`);
        }
        return {
          allowedContentTypes: ["image/*", "application/pdf"],
          maximumSizeInBytes: RELAY_MAX_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Math.min(Date.now() + 15 * 60_000, session.expiresAt.getTime()),
        };
      },
      onUploadCompleted: async () => {
        // The kiosk finds the file by listing the session folder.
      },
    });
    return NextResponse.json(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível enviar.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
