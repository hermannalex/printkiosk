"use server";

import { redirect } from "next/navigation";
import { requireMaster } from "@/lib/auth";
import { runBackup } from "@/lib/backup";
import { audit, rateLimit } from "@/lib/security";

const go = (key: "msg" | "erro", text: string): never => redirect(`/master/backups?${key}=${encodeURIComponent(text)}`);

export async function masterRunBackup() {
  const master = await requireMaster();
  if (!(await rateLimit(`backup:user:${master.id}`, 6, 60 * 60))) go("erro", "Backups manuais demais nesta hora. Tente mais tarde.");
  let message = "";
  try {
    const r = await runBackup();
    await audit(master.id, "backup_manual", r.pathname, `${r.tables} tabelas, ${r.rows} linhas, ${r.bytes} bytes`);
    message = `Backup feito: ${r.tables} tabelas, ${r.rows} linhas.`;
  } catch (error) {
    console.error("backup", error);
    await audit(master.id, "backup_falhou", null, error instanceof Error ? error.message : String(error));
    go("erro", "O backup falhou. Veja os detalhes em Auditoria.");
  }
  go("msg", message);
}
