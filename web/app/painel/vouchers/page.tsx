import Link from "next/link";
import { createVouchers, toggleVoucher } from "../../voucher-actions";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { brl, dateBR, dateTimeBR, todayIso } from "@/lib/format";
import { voucherStatus } from "@/lib/vouchers";
import { Flash, Shell, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Vouchers · imprime.ai" };
export const dynamic = "force-dynamic";

const PILL = { ativo: "pill-active", esgotado: "pill-demo", vencido: "pill-expired", desativado: "pill-expired" } as const;

export default async function OwnerVouchers({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const lote = param(params, "lote");
  const today = todayIso();
  const vouchers = await sql`
    select v.*, (select count(*)::int from voucher_uses u where u.voucher_id = v.id and not u.refunded) as uses
    from vouchers v where owner_id = ${user.id} order by created_at desc, id desc limit 500`;
  const totals = await sql`
    select coalesce(sum(balance_cents) filter (where not disabled and (expires_on is null or expires_on >= ${today}::date)), 0)::bigint as open,
           coalesce(sum(value_cents - balance_cents), 0)::bigint as used
    from vouchers where owner_id = ${user.id}`;

  return (
    <Shell user={user} area="owner" current="/painel/vouchers">
      <div className="page-head">
        <div>
          <h1>Vouchers de crédito</h1>
          <p>Códigos com saldo em reais que o cliente digita no quiosque para pagar a impressão. Valem em todos os seus quiosques.</p>
        </div>
      </div>
      <Flash msg={param(params, "msg")} erro={param(params, "erro")} />
      {lote && (
        <p className="notice notice-ok">
          Lote pronto. <Link href={`/painel/vouchers/imprimir?lote=${encodeURIComponent(lote)}`}>Abrir para imprimir ou salvar em PDF</Link>
        </p>
      )}

      <section className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Criar vouchers</h2></div>
          <form action={createVouchers} className="stack">
            <div className="field">
              <label htmlFor="valor">Valor de cada voucher (R$)</label>
              <input id="valor" name="valor" inputMode="decimal" placeholder="10,00" required maxLength={10} />
            </div>
            <div className="field">
              <label htmlFor="quantidade">Quantidade</label>
              <input id="quantidade" name="quantidade" type="number" min={1} max={100} defaultValue={1} required />
            </div>
            <div className="field">
              <label htmlFor="validade">Válido até (opcional)</label>
              <input id="validade" name="validade" type="date" min={today} />
            </div>
            <div className="field">
              <label htmlFor="observacao">Observação (opcional)</label>
              <input id="observacao" name="observacao" maxLength={80} placeholder="Ex.: cliente Maria, troco, promoção" />
            </div>
            <div><button className="btn btn-primary" type="submit">Criar</button></div>
          </form>
        </div>
        <div className="card stack">
          <div className="card-head"><h2>Saldo</h2></div>
          <p><b>{brl(totals[0]?.open ?? 0)}</b> em vouchers ativos ainda não usados.</p>
          <p><b>{brl(totals[0]?.used ?? 0)}</b> já usados em impressões.</p>
          <p className="small muted">
            Use para vender créditos no balcão, dar troco, devolver uma impressão que falhou ou fazer promoções.
            O cliente toca em <b>Voucher</b> na hora de pagar e digita o código. Se a impressão falhar, o valor volta ao voucher.
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Seus vouchers</h2></div>
        {vouchers.length === 0 ? <p className="empty">Nenhum voucher ainda.</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Código</th><th>Valor</th><th>Saldo</th><th>Situação</th><th>Usos</th><th>Validade</th><th>Observação</th><th>Criado</th><th></th></tr>
              </thead>
              <tbody>
                {vouchers.map((v) => {
                  const status = voucherStatus(v as any, today);
                  return (
                    <tr key={v.id}>
                      <td className="mono">{v.code}</td>
                      <td>{brl(v.value_cents)}</td>
                      <td><b>{brl(v.balance_cents)}</b></td>
                      <td><span className={`pill ${PILL[status]}`}>{status}</span></td>
                      <td>{v.uses}</td>
                      <td className="small">{v.expires_on ? dateBR(v.expires_on) : "—"}</td>
                      <td className="small">{v.note ?? ""}</td>
                      <td className="small muted">{dateTimeBR(v.created_at)}</td>
                      <td className="row">
                        <form action={toggleVoucher}>
                          <input type="hidden" name="id" value={String(v.id)} />
                          <button className="btn btn-sm" type="submit">{v.disabled ? "Reativar" : "Desativar"}</button>
                        </form>
                        <Link className="btn btn-sm" href={`/painel/vouchers/imprimir?lote=${encodeURIComponent(v.batch)}`}>Lote</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}
