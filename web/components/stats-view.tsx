import Link from "next/link";
import { DailyBars, HourBars } from "./charts";
import { Kpi } from "./ui";
import { brl, dateTimeBR, num } from "@/lib/format";
import { byKiosk, dailySeries, hourly, periodTotals, recentJobs, type Scope } from "@/lib/stats";

export const PERIODS = [7, 30, 90];

export function PeriodPicker({ days, basePath }: { days: number; basePath: string }) {
  return (
    <nav className="nav" aria-label="Período">
      {PERIODS.map((d) => (
        <Link key={d} href={`${basePath}?dias=${d}`} aria-current={d === days ? "page" : undefined}>
          {d} dias
        </Link>
      ))}
    </nav>
  );
}

export async function StatsView({
  scope,
  days,
  kioskLink,
  showKioskTable = true,
}: {
  scope: Scope;
  days: number;
  kioskLink: (id: number) => string;
  showKioskTable?: boolean;
}) {
  const [totals, series, hours, kiosks, jobs] = await Promise.all([
    periodTotals(scope, days),
    dailySeries(scope, days),
    hourly(scope, days),
    showKioskTable ? byKiosk(scope, days) : Promise.resolve([]),
    recentJobs(scope, 15),
  ]);
  const t = totals.current;
  const ticket = t.jobs ? Math.round(t.revenue / t.jobs) : 0;
  const busiest = hours.indexOf(Math.max(...hours));

  return (
    <>
      <section className="kpis" aria-label="Resumo do período">
        <Kpi label="Faturamento Pix" value={brl(t.revenue)} delta={totals.delta.revenue} foot={`vs. ${days} dias anteriores`} />
        <Kpi label="Impressões" value={num(t.jobs)} delta={totals.delta.jobs} foot={`${num(t.pixJobs)} pagas com Pix`} />
        <Kpi label="Páginas impressas" value={num(t.pages)} delta={totals.delta.pages} foot={`${num(t.copies)} cópias`} />
        <Kpi label="Ticket médio" value={brl(ticket)} foot={t.jobs ? `Pico às ${busiest}h` : "Sem impressões no período"} />
      </section>

      <section className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Faturamento por dia</h2>
            <span className="small muted">Pix recebido nos quiosques</span>
          </div>
          <DailyBars points={series.map((p) => ({ day: p.day, value: p.revenue }))} format={(v) => brl(v)} label="Faturamento por dia" />
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Páginas por dia</h2>
            <span className="small muted">Páginas × cópias</span>
          </div>
          <DailyBars points={series.map((p) => ({ day: p.day, value: p.pages }))} format={(v) => num(v)} label="Páginas por dia" />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Movimento por horário</h2>
          <span className="small muted">Impressões em cada hora do dia, horário de Brasília</span>
        </div>
        <HourBars counts={hours} />
      </section>

      {showKioskTable && (
        <section className="card">
          <div className="card-head"><h2>Por quiosque</h2></div>
          {kiosks.length === 0 ? (
            <p className="empty">Nenhum quiosque ainda.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Quiosque</th>
                    <th className="num">Impressões</th>
                    <th className="num">Páginas</th>
                    <th className="num">Cópias</th>
                    <th className="num">Faturamento</th>
                  </tr>
                </thead>
                <tbody>
                  {kiosks.map((k) => (
                    <tr key={k.id}>
                      <td>
                        <Link href={kioskLink(Number(k.id))}>{k.name}</Link>{" "}
                        <span className="mono small muted">{k.store_code}</span>
                      </td>
                      <td className="num">{num(k.jobs)}</td>
                      <td className="num">{num(k.pages)}</td>
                      <td className="num">{num(k.copies)}</td>
                      <td className="num">{brl(k.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <div className="card-head"><h2>Últimas impressões</h2></div>
        {jobs.length === 0 ? (
          <p className="empty">As impressões aparecem aqui assim que o quiosque se conectar à internet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quiosque</th>
                  <th className="num">Itens</th>
                  <th className="num">Páginas</th>
                  <th className="num">Cópias</th>
                  <th className="num">Total</th>
                  <th className="num">Valor</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="mono small">{dateTimeBR(j.printed_at)}</td>
                    <td>{j.kiosk_name}</td>
                    <td className="num">{num(j.items)}</td>
                    <td className="num">{num(j.pages)}</td>
                    <td className="num">{num(j.copies)}</td>
                    <td className="num">{num(j.total_pages)}</td>
                    <td className="num">{j.paid_with_pix ? brl(j.amount_cents) : "—"}</td>
                    <td>
                      {!j.success ? (
                        <span className="pill pill-expired">Falhou</span>
                      ) : j.demo ? (
                        <span className="pill pill-demo">Demonstração</span>
                      ) : (
                        <span className="pill pill-active">Impressa</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
