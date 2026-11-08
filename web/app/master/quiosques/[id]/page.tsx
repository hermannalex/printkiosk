import { notFound } from "next/navigation";
import { masterAssignOwner, masterGenerateCode, masterManualPayment, masterSetPlan } from "../../../actions";
import { requireMaster } from "@/lib/auth";
import { one, sql } from "@/lib/db";
import { addMonthsIso, ago, brl, dateBR, dateTimeBR, todayIso } from "@/lib/format";
import { kioskStatus } from "@/lib/kiosks";
import { CopyButton } from "@/components/copy-button";
import { KioskConfigForm } from "@/components/kiosk-config-form";
import { Flash, PlanPill, Shell, StatusPill, param, type SearchParams } from "@/components/ui";
import { StatsView } from "@/components/stats-view";

export const metadata = { title: "Quiosque · Master · Quioco" };
export const dynamic = "force-dynamic";

export default async function MasterKiosk({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const user = await requireMaster();
  const { id } = await params;
  const query = await searchParams;
  const kiosk = await one`select k.*, u.name as owner_name, u.email as owner_email, u.phone as owner_phone
                          from kiosks k left join users u on u.id = k.owner_id where k.id = ${Number(id)}`;
  if (!kiosk) notFound();

  const [codes, subs, payments] = await Promise.all([
    sql`select c.*, u.name as by_name from activation_codes c left join users u on u.id = c.created_by
        where c.kiosk_id = ${kiosk.id} order by c.id desc limit 10`,
    sql`select * from subscriptions where kiosk_id = ${kiosk.id} order by id desc limit 10`,
    sql`select * from payments where kiosk_id = ${kiosk.id} order by paid_at desc limit 10`,
  ]);
  const suggested = addMonthsIso(todayIso(), 1);

  return (
    <Shell user={user} area="master" current="/master/quiosques">
      <div className="page-head">
        <div>
          <h1>{kiosk.name}</h1>
          <p>
            <span className="mono">{kiosk.store_code}</span> · <StatusPill status={kioskStatus(kiosk)} /> <PlanPill plan={kiosk.plan} /> ·
            válido até {dateBR(kiosk.paid_until)} · {kiosk.platform ?? "aparelho desconhecido"} {kiosk.app_version ?? ""} ·
            última conexão {ago(kiosk.last_seen_at)}
          </p>
        </div>
      </div>
      <Flash msg={param(query, "msg")} erro={param(query, "erro")} />

      <section className="grid-2">
        <div className="card stack">
          <h2>Liberação</h2>
          <form action={masterGenerateCode} className="inline">
            <input type="hidden" name="id" value={kiosk.id} />
            <div className="field">
              <label htmlFor="ate">Gerar código válido até</label>
              <input id="ate" name="ate" type="date" defaultValue={suggested} min={todayIso()} required />
            </div>
            <button className="btn btn-primary" type="submit">Gerar código</button>
          </form>
          <form action={masterManualPayment} className="inline">
            <input type="hidden" name="id" value={kiosk.id} />
            <div className="field">
              <label htmlFor="meses">Pagamento recebido por fora</label>
              <select id="meses" name="meses" defaultValue="1">
                {[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>{m} {m === 1 ? "mês" : "meses"}</option>)}
              </select>
            </div>
            <button className="btn" type="submit">Registrar e liberar</button>
          </form>
          <form action={masterSetPlan} className="inline">
            <input type="hidden" name="id" value={kiosk.id} />
            <div className="field">
              <label htmlFor="plano">Plano</label>
              <select id="plano" name="plano" defaultValue={kiosk.plan}>
                <option value="basic">Básico</option>
                <option value="pro">Pro</option>
              </select>
            </div>
            <button className="btn" type="submit">Alterar plano</button>
          </form>
        </div>

        <div className="card stack">
          <h2>Loja</h2>
          <p>
            {kiosk.owner_name ? (
              <>
                <b>{kiosk.owner_name}</b> · {kiosk.owner_email}
                {kiosk.owner_phone && <> · {kiosk.owner_phone}</>}
              </>
            ) : (
              <span className="muted">Este quiosque ainda não está ligado a nenhuma conta.</span>
            )}
          </p>
          <form action={masterAssignOwner} className="inline">
            <input type="hidden" name="id" value={kiosk.id} />
            <div className="field">
              <label htmlFor="email">Ligar à conta (e-mail)</label>
              <input id="email" name="email" type="email" placeholder="loja@exemplo.com" required />
            </div>
            <button className="btn" type="submit">Ligar</button>
          </form>
          {kiosk.demo_remaining != null && !kiosk.paid_until && (
            <p className="small muted">Demonstração: {kiosk.demo_remaining} impressões restantes no aparelho.</p>
          )}
        </div>
      </section>

      <KioskConfigForm kiosk={kiosk} from="master" />

      <section className="card">
        <div className="card-head"><h2>Códigos de ativação</h2></div>
        {codes.length === 0 ? <p className="empty">Nenhum código gerado.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Válido até</th><th>Origem</th><th>Gerado em</th><th>Por</th><th>Código</th></tr></thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{dateBR(c.valid_until)}</td>
                    <td>{c.source === "payment" ? "Pagamento" : "Manual"}</td>
                    <td className="mono small">{dateTimeBR(c.created_at)}</td>
                    <td>{c.by_name ?? "Sistema"}</td>
                    <td><CopyButton text={c.code} label="Copiar" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Assinaturas Mercado Pago</h2></div>
          {subs.length === 0 ? <p className="empty">Nenhuma.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Criada</th><th>Plano</th><th className="num">Valor</th><th>Status</th></tr></thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.id}>
                      <td className="mono small">{dateTimeBR(s.created_at)}</td>
                      <td><PlanPill plan={s.plan} /></td>
                      <td className="num">{brl(s.amount_cents)}</td>
                      <td>{s.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h2>Pagamentos</h2></div>
          {payments.length === 0 ? <p className="empty">Nenhum.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Data</th><th className="num">Valor</th><th>Status</th></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="mono small">{dateTimeBR(p.paid_at)}</td>
                      <td className="num">{brl(p.amount_cents)}</td>
                      <td>{p.status === "manual" ? "Manual" : p.status === "approved" ? "Aprovado" : p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <h2>Movimento deste quiosque</h2>
      <StatsView scope={[Number(kiosk.id)]} days={30} kioskLink={(kid) => `/master/quiosques/${kid}`} showKioskTable={false} />
    </Shell>
  );
}
