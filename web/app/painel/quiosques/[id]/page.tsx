import { notFound } from "next/navigation";
import { cancelSubscription, renameKiosk, subscribe } from "../../../actions";
import { requireUser } from "@/lib/auth";
import { one, sql } from "@/lib/db";
import { ago, brl, dateBR, dateTimeBR } from "@/lib/format";
import { kioskStatus } from "@/lib/kiosks";
import { PLANS, monthlyPrice, type PlanId } from "@/lib/plans";
import { KioskConfigForm } from "@/components/kiosk-config-form";
import { CopyButton } from "@/components/copy-button";
import { Flash, PlanPill, Shell, StatusPill, param, type SearchParams } from "@/components/ui";
import { PERIODS, PeriodPicker, StatsView } from "@/components/stats-view";
import { todayIso, isoOf } from "@/lib/format";

export const metadata = { title: "Quiosque · imprime.ai" };
export const dynamic = "force-dynamic";

const SUB_STATUS: Record<string, string> = {
  pending: "Aguardando pagamento",
  authorized: "Ativa",
  paused: "Pausada",
  cancelled: "Cancelada",
};

export default async function OwnerKiosk({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const days = PERIODS.includes(Number(param(query, "dias"))) ? Number(param(query, "dias")) : 30;

  const kiosk = await one`select * from kiosks where id = ${Number(id)} and owner_id = ${user.id}`;
  if (!kiosk) notFound();

  const [codes, subscriptions] = await Promise.all([
    sql`select * from activation_codes where kiosk_id = ${kiosk.id} order by valid_until desc, id desc limit 6`,
    sql`select * from subscriptions where kiosk_id = ${kiosk.id} order by created_at desc limit 5`,
  ]);
  const status = kioskStatus(kiosk);
  const proActive = kiosk.plan === "pro" && (isoOf(kiosk.paid_until) ?? "") >= todayIso();
  const activeSub = subscriptions.find((s) => s.status === "authorized" || s.status === "pending");
  const latest = codes[0];
  const proPrice = await monthlyPrice("pro", user.id, Number(kiosk.id));
  const price = (plan: PlanId) => (plan === "pro" ? proPrice.cents : PLANS.basic.cents);

  return (
    <Shell user={user} area="owner" current="/painel/quiosques">
      <div className="page-head">
        <div>
          <h1>{kiosk.name}</h1>
          <p>
            <span className="mono">{kiosk.store_code}</span> · <StatusPill status={status} /> <PlanPill plan={kiosk.plan} /> ·
            última conexão {ago(kiosk.last_seen_at)}
          </p>
        </div>
        {proActive && <PeriodPicker days={days} basePath={`/painel/quiosques/${kiosk.id}`} />}
      </div>
      <Flash msg={param(query, "msg")} erro={param(query, "erro")} />

      <section className="grid-2">
        <div className="card stack">
          <h2>Assinatura</h2>
          {activeSub ? (
            <>
              <p>
                Plano <b>{PLANS[activeSub.plan as PlanId].name}</b> · {brl(activeSub.amount_cents)}/mês ·{" "}
                {SUB_STATUS[activeSub.status] ?? activeSub.status}
              </p>
              <p className="muted small">
                Liberado até <b>{dateBR(kiosk.paid_until)}</b>. A cada pagamento o quiosque recebe o novo código sozinho.
              </p>
              <div className="inline" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {activeSub.status === "pending" && activeSub.init_point && (
                  <a className="btn btn-primary" href={activeSub.init_point}>Concluir pagamento</a>
                )}
                <form action={cancelSubscription}>
                  <input type="hidden" name="assinatura" value={activeSub.id} />
                  <button className="btn btn-danger" type="submit">Cancelar assinatura</button>
                </form>
              </div>
            </>
          ) : (
            <>
              <p className="muted">
                {status === "active"
                  ? `Liberado até ${dateBR(kiosk.paid_until)}. Assine para renovar automaticamente.`
                  : "Escolha um plano. O pagamento é mensal, no cartão, pelo Mercado Pago."}
              </p>
              <div className="plans">
                {(Object.keys(PLANS) as PlanId[]).map((plan) => (
                  <div key={plan} className={`plan ${plan === "pro" ? "featured" : ""}`}>
                    <h3>{PLANS[plan].name}</h3>
                    <div className="plan-price">{brl(price(plan))}<span className="small muted">/mês</span></div>
                    {plan === "pro" && (
                      <p className="small muted">
                        {proPrice.extra
                          ? `Preço de quiosque adicional: você já tem um quiosque no Pro (${brl(PLANS.pro.cents)}/mês).`
                          : `${brl(PLANS.pro.cents)} pelo primeiro quiosque e ${brl(PLANS.pro.extraCents)} por quiosque adicional.`}
                      </p>
                    )}
                    <p className="small muted">{PLANS[plan].summary}</p>
                    <ul className="small">{PLANS[plan].features.map((f) => <li key={f}>{f}</li>)}</ul>
                    <form action={subscribe}>
                      <input type="hidden" name="id" value={kiosk.id} />
                      <input type="hidden" name="plano" value={plan} />
                      <button className={`btn ${plan === "pro" ? "btn-primary" : ""}`} type="submit">
                        Assinar {PLANS[plan].name}
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card stack">
          <h2>Código de ativação</h2>
          {latest ? (
            <>
              <p className="muted small">
                Válido até <b>{dateBR(latest.valid_until)}</b>. O quiosque baixa este código sozinho quando está na internet.
                Se precisar, cole em <b>Configurações › Assinatura</b>.
              </p>
              <div className="code-box">{latest.code}</div>
              <div><CopyButton text={latest.code} label="Copiar código" /></div>
            </>
          ) : (
            <p className="muted">
              Ainda não há código. Ele é gerado quando o primeiro pagamento é confirmado.
              {kiosk.demo_remaining != null && ` Demonstração: ${kiosk.demo_remaining} impressões restantes.`}
            </p>
          )}
          <form action={renameKiosk} className="inline">
            <input type="hidden" name="id" value={kiosk.id} />
            <div className="field">
              <label htmlFor="nome">Nome do quiosque</label>
              <input id="nome" name="nome" defaultValue={kiosk.name} />
            </div>
            <button className="btn" type="submit">Salvar</button>
          </form>
                    {codes.length > 1 && (
            <details>
              <summary className="small muted">Códigos anteriores</summary>
              <ul className="small">
                {codes.slice(1).map((c) => (
                  <li key={c.id}>Válido até {dateBR(c.valid_until)} · gerado em {dateTimeBR(c.created_at)}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </section>

      <KioskConfigForm kiosk={kiosk} from="painel" />

      {proActive ? (
        <StatsView scope={[Number(kiosk.id)]} days={days} kioskLink={(kid) => `/painel/quiosques/${kid}`} showKioskTable={false} />
      ) : (
        <section className="card">
          <p className="muted">Assine o plano <b>Pro</b> para ver as cópias, o faturamento e o histórico deste quiosque.</p>
        </section>
      )}
    </Shell>
  );
}
