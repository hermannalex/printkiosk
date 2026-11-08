import { masterRunBackup } from "../../backup-actions";
import { requireMaster } from "@/lib/auth";
import { KEEP_DAYS, listBackups, type StoredBackup } from "@/lib/backup";
import { sql } from "@/lib/db";
import { dateTimeBR, num } from "@/lib/format";
import { Flash, Shell, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Backups · Master · Quioco" };
export const dynamic = "force-dynamic";

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${num(Math.ceil(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);

export default async function MasterBackups({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireMaster();
  const params = await searchParams;
  let backups: StoredBackup[] = [];
  let storeError = "";
  try {
    backups = await listBackups();
  } catch (error) {
    storeError = error instanceof Error ? error.message : String(error);
  }
  const failures = await sql`select created_at, detail from audit_log where action = 'backup_falhou'
                             and created_at > now() - interval '7 days' order by created_at desc limit 3`;
  const newest = backups[0];
  const stale = !newest || Date.now() - newest.uploadedAt.getTime() > 36 * 3_600_000;

  return (
    <Shell user={user} area="master" current="/master/backups">
      <div className="page-head">
        <div>
          <h1>Backups</h1>
          <p>Cópia diária criptografada do banco, guardada fora do Neon.</p>
        </div>
        <form action={masterRunBackup}>
          <button className="btn btn-primary" type="submit">Fazer backup agora</button>
        </form>
      </div>
      <Flash msg={param(params, "msg")} erro={param(params, "erro")} />

      <section className="card stack">
        <div>
          <span className={`pill ${stale ? "pill-expired" : "pill-active"}`}>
            {newest ? `Último backup: ${dateTimeBR(newest.uploadedAt)}` : "Nenhum backup ainda"}
          </span>
        </div>
        {storeError && <p className="muted"><b>Armazenamento:</b> {storeError}</p>}
        {failures.map((f, i) => (
          <p key={i} className="small muted"><b>Falhou em {dateTimeBR(f.created_at)}:</b> {f.detail}</p>
        ))}
        <ul className="small stack">
          <li><b>Neon (banco):</b> snapshots automáticos todo dia, guardados por 14 dias, e um por semana, guardado por 35 dias.</li>
          <li><b>Vercel Blob (fora do banco):</b> exportação completa todo dia às 3h (horário de Brasília), guardada por {KEEP_DAYS} dias, nunca menos que as 7 mais recentes.</li>
          <li>Cada arquivo é criptografado (AES-256 + RSA-4096). O servidor só tem a chave pública; só a chave privada, guardada fora da internet, abre os arquivos.</li>
          <li>Sessões, tentativas de login e contadores de limite não entram: se recriam sozinhos.</li>
        </ul>
      </section>

      <section className="card">
        <h2>Arquivos</h2>
        {backups.length === 0 ? <p className="empty">Nenhum arquivo ainda.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Quando</th><th>Tamanho</th><th></th></tr></thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.pathname}>
                    <td className="mono small">{dateTimeBR(b.uploadedAt)}</td>
                    <td className="small">{size(b.size)}</td>
                    <td><a className="btn btn-sm" href={`/api/master/backup?arquivo=${encodeURIComponent(b.pathname)}`}>Baixar</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">
          Para abrir um arquivo: <span className="mono">node tools/restaurar-backup.mjs arquivo.qbk chave-privada.pem --sql</span> na
          pasta <span className="mono">web</span> do projeto. Ele gera um .json legível e um .sql para recarregar num banco vazio.
        </p>
      </section>
    </Shell>
  );
}
