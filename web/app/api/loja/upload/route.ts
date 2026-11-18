import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { ipFromHeaders, rateLimit } from "@/lib/security";
import { STORE_MAX_BYTES, UPLOAD_TYPES, openStore, validStorePathname } from "@/lib/store";
import { currentCustomer } from "@/lib/store-auth";

export const dynamic = "force-dynamic";

/**
 * Gives a signed-in store customer a short-lived token to upload one file straight to Vercel Blob,
 * only into their own folder, only PDFs and photos, at most 50 MB.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  const ip = ipFromHeaders(request.headers);
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const store = await openStore(String(clientPayload ?? ""));
        if (!store) throw new Error("Esta loja não está recebendo pedidos agora.");
        const customer = await currentCustomer(store.id);
        if (!customer) throw new Error("Entre de novo para enviar arquivos.");
        if (!(await rateLimit(`loja-up:${customer.id}`, 200, 3600)) || !(await rateLimit(`loja-up-ip:${ip}`, 300, 3600))) {
          throw new Error("Muitos envios. Aguarde alguns minutos.");
        }
        if (!validStorePathname(store.id, customer.id, pathname)) throw new Error("Envio inválido.");
        return {
          allowedContentTypes: UPLOAD_TYPES,
          maximumSizeInBytes: STORE_MAX_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + 15 * 60_000,
        };
      },
      onUploadCompleted: async () => {
        // The browser asks /api/loja/arquivo to check the file right after.
      },
    });
    return NextResponse.json(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível enviar.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
