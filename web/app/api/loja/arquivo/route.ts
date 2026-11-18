import { del, get } from "@vercel/blob";
import { rateLimit } from "@/lib/security";
import { STORE_MAX_BYTES, countPdfPages, kindOf, openStore, signFile, validStorePathname, type CheckedFile } from "@/lib/store";
import { currentCustomer } from "@/lib/store-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fail = (error: string, status = 400) => Response.json({ error }, { status });

/**
 * Right after an upload: reads the file, counts its pages and signs the result, so the price of the
 * order is computed from what the server saw, not from what the browser says.
 */
export async function POST(request: Request) {
  const input = await request.json().catch(() => ({}));
  const store = await openStore(String(input?.slug ?? ""));
  if (!store) return fail("Esta loja não está recebendo pedidos agora.", 404);
  const customer = await currentCustomer(store.id);
  if (!customer) return fail("Entre de novo para continuar.", 401);
  const pathname = String(input?.pathname ?? "");
  if (!validStorePathname(store.id, customer.id, pathname)) return fail("Arquivo inválido.");
  if (!(await rateLimit(`loja-arquivo:${customer.id}`, 300, 3600))) return fail("Muitos arquivos. Aguarde alguns minutos.", 429);

  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) return fail("O arquivo não chegou. Envie de novo.", 404);
  const name = pathname.split("/").pop() || "arquivo";
  const kind = kindOf(name, result.blob.contentType ?? "");
  const size = Number(result.blob.size ?? 0);
  if (!kind || size <= 0 || size > STORE_MAX_BYTES) {
    await del(pathname).catch(() => {});
    return fail(kind ? "Arquivo vazio ou grande demais." : "Envie apenas fotos ou PDF.");
  }

  let pages = 1;
  if (kind === "pdf") {
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    pages = await countPdfPages(bytes);
    if (pages < 1) {
      await del(pathname).catch(() => {});
      return fail("Não foi possível ler este PDF. Salve-o de novo como PDF e envie outra vez.");
    }
    if (pages > 2000) return fail("PDF com páginas demais (máximo 2.000).");
  } else {
    await result.stream.cancel().catch(() => {});
  }

  const file: CheckedFile = { pathname, name, kind, size, pages };
  return Response.json({ file: { ...file, token: signFile(store.id, customer.id, file) } });
}
