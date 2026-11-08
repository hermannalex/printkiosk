import { requireMaster } from "@/lib/auth";
import { sql } from "@/lib/db";
import { dateTimeBR } from "@/lib/format";
import { Shell } from "@/components/ui";

export const metadata = { title: "Auditoria · Master · Quioco" };
export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  login: "Entrou",
  login_falhou: "Senha errada",
  login_bloqueado: "Login bloqueado por excesso de tentativas",
  cadastro: "Criou conta",
  cadastro_master: "Criou a conta master",
  cadastro_master_recusado: "Tentou criar conta master",
  quiosque_vinculado: "Vinculou quiosque",
  vinculo_recusado: "Código de vinculação errado",
  assinatura_iniciada: "Abriu assinatura",
  assinatura_cancelada: "Cancelou assinatura",
  codigo_gerado: "Gerou código de ativação",
  pagamento_manual: "Registrou pagamento manual",
  plano_alterado: "Mudou plano",
  dono_alterado: "Mudou dono do quiosque",
  conta_bloqueada: "Bloqueou conta",
  conta_desbloqueada: "Desbloqueou conta",
  webhook_valor_divergente: "Pagamento com valor diferente do plano",
  senha_ok: "Senha certa, aguardando código",
  login_sem_2fa: "Entrou para configurar 2 etapas",
  login_com_recuperacao: "Entrou com código de recuperação",
  mfa_falhou: "Código de 2 etapas errado",
  mfa_ativado: "Ativou 2 etapas",
  mfa_novos_codigos: "Gerou novos códigos de recuperação",
  mfa_redefinido: "Redefiniu 2 etapas de uma conta",
};

const ALERT = new Set(["login_falhou", "login_bloqueado", "cadastro_master_recusado", "vinculo_recusado", "webhook_valor_divergente", "mfa_falhou", "login_com_recuperacao", "mfa_redefinido"]);

export default async function MasterAudit() {
  const user = await requireMaster();
  const rows = await sql`
    select a.*, u.name as user_name, u.email as user_email
    from audit_log a left join users u on u.id = a.user_id
    order by a.created_at desc limit 300`;

  return (
    <Shell user={user} area="master" current="/master/auditoria">
      <div className="page-head">
        <div>
          <h1>Auditoria</h1>
          <p>Entradas, tentativas recusadas e ações do master, das mais recentes para as mais antigas.</p>
        </div>
      </div>
      <section className="card">
        {rows.length === 0 ? <p className="empty">Nada registrado ainda.</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Alvo</th><th>Detalhe</th><th>IP</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono small">{dateTimeBR(r.created_at)}</td>
                    <td>{r.user_name ?? <span className="muted">—</span>}</td>
                    <td>
                      {ALERT.has(r.action) ? <span className="pill pill-expired">{LABEL[r.action] ?? r.action}</span> : (LABEL[r.action] ?? r.action)}
                    </td>
                    <td className="mono small">{r.target ?? ""}</td>
                    <td className="small">{r.detail ?? ""}</td>
                    <td className="mono small muted">{r.ip ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}
