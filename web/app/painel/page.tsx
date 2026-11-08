import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { ownerHasPro } from "@/lib/kiosks";
import { PLANS } from "@/lib/plans";
import { brl } from "@/lib/format";
import { Flash, Shell, param, type SearchParams } from "@/components/ui";
import { PERIODS, PeriodPicker, StatsView } from "@/components/stats-view";

export const metadata = { title: "Visão geral · Quioco" };
export const dynamic = "force-dynamic";

export default async function OwnerOverview({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const days = PERIODS.includes(Number(param(params, "dias"))) ? Number(param(params, "dias")) : 30;
  const kiosks = await sql`select id from kiosks where owner_id = ${user.id}`;
  const ids = kiosks.map((k) => Number(k.id));
  const hasPro = await ownerHasPro(user.id);

  return (
    <Shell user={user} area="owner" current="/painel">
      <div className="page-head">
        <div>
          <h1>Olá, {user.name.split(" ")[0]}</h1>
          <p>{hasPro ? "Cópias, faturamento e movimento dos seus quiosques." : "Acompanhe sua loja com o plano Pro."}</p>
        </div>
        {hasPro && <PeriodPicker days={days} basePath="/painel" />}
      </div>
      <Flash msg={param(params, "msg")} erro={param(params, "erro")} />

      {ids.length === 0 ? (
        <section className="card stack">
          <h2>Adicione o seu primeiro quiosque</h2>
          <p className="muted">
            No aparelho, abra <b>Configurações › Assinatura</b> e copie o <b>código da loja</b> (por exemplo ABCD-EFGH).
          </p>
          <div><Link className="btn btn-primary" href="/painel/quiosques">Adicionar quiosque</Link></div>
        </section>
      ) : hasPro ? (
        <StatsView scope={ids} days={days} kioskLink={(id) => `/painel/quiosques/${id}`} />
      ) : (
        <section className="card stack">
          <h2>O dashboard faz parte do plano Pro</h2>
          <p className="muted">
            Com o Pro ({brl(PLANS.pro.cents)}/mês, mais {brl(PLANS.pro.extraCents)}/mês por quiosque adicional) você vê
            faturamento, cópias por dia, horários de pico e o histórico de impressões. O plano Básico
            ({brl(PLANS.basic.cents)}/mês por quiosque) libera o app no quiosque.
          </p>
          <div><Link className="btn btn-primary" href="/painel/quiosques">Ver quiosques e assinar</Link></div>
        </section>
      )}
    </Shell>
  );
}
