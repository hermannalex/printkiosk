import { requireMaster } from "@/lib/auth";
import { readBackup } from "@/lib/backup";
import { audit } from "@/lib/security";

export const dynamic = "force-dynamic";

/** Master only: downloads one encrypted backup, to keep a copy offline. */
export async function GET(request: Request) {
  const master = await requireMaster();
  const pathname = new URL(request.url).searchParams.get("arquivo") ?? "";
  const result = await readBackup(pathname);
  if (!result) return new Response("Backup não encontrado.", { status: 404 });
  await audit(master.id, "backup_baixado", pathname);
  return new Response(result.stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${pathname.split("/").pop()}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
