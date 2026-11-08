import { runBackup } from "@/lib/backup";
import { audit, safeEqual } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Called by Vercel Cron every day (vercel.json), which sends "Authorization: Bearer CRON_SECRET". */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = request.headers.get("authorization") ?? "";
  if (secret.length < 16 || !safeEqual(given, `Bearer ${secret}`)) {
    return new Response("unauthorized", { status: 401 });
  }
  try {
    const result = await runBackup();
    await audit(null, "backup_ok", result.pathname, `${result.tables} tabelas, ${result.rows} linhas, ${result.bytes} bytes; ${result.removed} antigo(s) apagado(s)`);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("backup", error);
    await audit(null, "backup_falhou", null, error instanceof Error ? error.message : String(error));
    return Response.json({ ok: false }, { status: 500 });
  }
}
