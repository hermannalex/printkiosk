import Link from "next/link";
import { requireMaster } from "@/lib/auth";
import { sql } from "@/lib/db";
import { brl, dateTimeBR } from "@/lib/format";
import { Shell } from "@/components/ui";

export const metadata = { title: "Pagamentos · Master · PrintKiosk" };
export const dynamic = "force-dynamic";

export default async function MasterPayments() {
  const user = await requireMaster();
  const payments = await sql`
    select p.*, k.name as kiosk_name, k.store_code, u.name as owner_name
    from payments p
    left join kiosks k on k.id = p.kiosk_id
    left join users u on u.id = p.owner_id
    order by p.paid_at desc limit 300`;
  const total = payments.filter((p) => p.status !== "rejected").reduce((sum, p) => sum + Number(p.amount_cents), 0);

  return (
    <Shell user={user} area="master" current="/master/pagamentos">
      <div className="page-head">
        <div>
          <h1>Pagamentos</h1>
          <p>Mensalidades recebidas pelo Mercado Pago e pagamentos registrados à mão. Total listado: {brl(total)}.</p>
        </div>
      </div>
      <section className="card">
        {payments.length === 0 ? <p className="empty">Nenhum pagamento ainda.</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Data</th><th>Loja</th><th>Quiosque</th><th className="num">Valor</th><th>Status</th><th>Referência</th></tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="mono small">{dateTimeBR(p.paid_at)}</td>
                    <td>{p.owner_name ?? "—"}</td>
                    <td>
                      {p.kiosk_id ? <Link href={`/master/quiosques/${p.kiosk_id}`}>{p.kiosk_name}</Link> : "—"}{" "}
                      <span className="mono small muted">{p.store_code}</span>
                    </td>
                    <td className="num">{brl(p.amount_cents)}</td>
                    <td>
                      <span className={`pill ${p.status === "rejected" ? "pill-expired" : "pill-active"}`}>
                        {p.status === "manual" ? "Manual" : p.status === "approved" ? "Aprovado" : p.status}
                      </span>
                    </td>
                    <td className="mono small muted">{p.mp_payment_id ?? p.note ?? ""}</td>
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
