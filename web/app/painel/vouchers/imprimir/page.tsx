import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { brl, dateBR } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { QuiocoMark, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Imprimir vouchers · Quioco" };
export const dynamic = "force-dynamic";

/** One card per voucher, sized to cut out (8 per A4 page). */
export default async function PrintVouchers({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const lote = (param(await searchParams, "lote") ?? "").slice(0, 16);
  const vouchers = await sql`select code, value_cents, balance_cents, expires_on, note from vouchers
                             where owner_id = ${user.id} and batch = ${lote} and not disabled order by id`;
  return (
    <main className="voucher-print">
      <div className="no-print row">
        <Link className="btn" href="/painel/vouchers">Voltar</Link>
        <PrintButton />
        <span className="muted small">{vouchers.length} voucher(s). Na janela de impressão você também pode salvar em PDF.</span>
      </div>
      <div className="voucher-grid">
        {vouchers.map((v) => (
          <div className="voucher-card" key={v.code}>
            <div className="voucher-brand"><QuiocoMark size={22} /> <span>Voucher de impressão</span></div>
            <div className="voucher-value">{brl(v.balance_cents)}</div>
            <div className="voucher-code mono">{v.code}</div>
            <div className="voucher-help">
              No quiosque, toque em <b>Voucher</b> na hora de pagar e digite o código.
              {v.expires_on ? <> Válido até {dateBR(v.expires_on)}.</> : null}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

