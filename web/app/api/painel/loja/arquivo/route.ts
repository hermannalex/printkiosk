import { get } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { audit } from "@/lib/security";
import { servedType } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The store owner opens (?item=<id>) or downloads (&baixar=1) a file of a paid order.
 * Files only leave the private store through here, after checking the order is the owner's.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || !user.mfaEnabled) return new Response("Entre no painel.", { status: 401 });
  const url = new URL(request.url);
  const itemId = Number(url.searchParams.get("item"));
  if (!Number.isSafeInteger(itemId) || itemId < 1) return new Response("Arquivo não encontrado.", { status: 404 });
  const item = await one`
    select i.pathname, i.file_name, i.kind, o.code, o.status, o.files_deleted_at
    from store_order_items i join store_orders o on o.id = i.order_id join stores s on s.id = o.store_id
    where i.id = ${itemId} and s.owner_id = ${user.id}`;
  if (!item || ["awaiting_payment", "expired"].includes(item.status)) return new Response("Arquivo não encontrado.", { status: 404 });
  if (item.files_deleted_at) return new Response("Este arquivo já foi apagado (pedidos encerrados guardam os arquivos por 7 dias).", { status: 410 });

  const result = await get(item.pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) return new Response("Arquivo não encontrado.", { status: 404 });
  const download = url.searchParams.get("baixar") === "1";
  if (download) await audit(user.id, "loja_arquivo_baixado", item.code, item.file_name);
  const ascii = String(item.file_name).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(result.stream, {
    headers: {
      "Content-Type": servedType(item.kind, result.blob.contentType ?? ""),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(item.file_name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
