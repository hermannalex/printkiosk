import { sql } from "./db";
import { TZ } from "./format";

/** Kiosk filter: `null` means every kiosk (master), otherwise a list of kiosk IDs. */
export type Scope = number[] | null;

function scopeParams(scope: Scope): [boolean, number[]] {
  return [scope === null, scope ?? []];
}

export type Totals = { jobs: number; pages: number; copies: number; revenue: number; pixJobs: number; cardJobs: number; voucherJobs: number };

async function totalsBetween(scope: Scope, fromDaysAgo: number, toDaysAgo: number): Promise<Totals> {
  const [all, ids] = scopeParams(scope);
  const rows = await sql`
    select count(*)::int as jobs,
           coalesce(sum(total_pages), 0)::int as pages,
           coalesce(sum(copies), 0)::int as copies,
           coalesce(sum(amount_cents), 0)::bigint as revenue,
           (count(*) filter (where payment_method = 'pix' or (payment_method is null and paid_with_pix)))::int as pix_jobs,
           (count(*) filter (where payment_method = 'card'))::int as card_jobs,
           (count(*) filter (where payment_method = 'voucher'))::int as voucher_jobs
    from print_jobs
    where success
      and printed_at >= now() - make_interval(days => ${fromDaysAgo})
      and printed_at <  now() - make_interval(days => ${toDaysAgo})
      and (${all}::boolean or kiosk_id = any(${ids}::bigint[]))`;
  const r = rows[0] ?? {};
  return { jobs: Number(r.jobs ?? 0), pages: Number(r.pages ?? 0), copies: Number(r.copies ?? 0), revenue: Number(r.revenue ?? 0), pixJobs: Number(r.pix_jobs ?? 0), cardJobs: Number(r.card_jobs ?? 0), voucherJobs: Number(r.voucher_jobs ?? 0) };
}

export async function periodTotals(scope: Scope, days: number) {
  const [current, previous] = await Promise.all([totalsBetween(scope, days, 0), totalsBetween(scope, days * 2, days)]);
  const delta = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  return {
    current,
    previous,
    delta: {
      jobs: delta(current.jobs, previous.jobs),
      pages: delta(current.pages, previous.pages),
      revenue: delta(current.revenue, previous.revenue),
    },
  };
}

export async function dailySeries(scope: Scope, days: number) {
  const [all, ids] = scopeParams(scope);
  const rows = await sql`
    select to_char((printed_at at time zone ${TZ})::date, 'YYYY-MM-DD') as day,
           count(*)::int as jobs,
           coalesce(sum(total_pages), 0)::int as pages,
           coalesce(sum(amount_cents), 0)::bigint as revenue
    from print_jobs
    where success
      and printed_at >= now() - make_interval(days => ${days})
      and (${all}::boolean or kiosk_id = any(${ids}::bigint[]))
    group by 1 order by 1`;
  const byDay = new Map(rows.map((r) => [String(r.day), r]));
  const out: { day: string; jobs: number; pages: number; revenue: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ });
    const r = byDay.get(day);
    out.push({ day, jobs: Number(r?.jobs ?? 0), pages: Number(r?.pages ?? 0), revenue: Number(r?.revenue ?? 0) });
  }
  return out;
}

export async function hourly(scope: Scope, days: number): Promise<number[]> {
  const [all, ids] = scopeParams(scope);
  const rows = await sql`
    select extract(hour from printed_at at time zone ${TZ})::int as hour, count(*)::int as jobs
    from print_jobs
    where success
      and printed_at >= now() - make_interval(days => ${days})
      and (${all}::boolean or kiosk_id = any(${ids}::bigint[]))
    group by 1`;
  const counts = new Array<number>(24).fill(0);
  for (const r of rows) counts[Number(r.hour)] = Number(r.jobs);
  return counts;
}

export async function byKiosk(scope: Scope, days: number) {
  const [all, ids] = scopeParams(scope);
  return sql`
    select k.id, k.name, k.store_code,
           count(j.id)::int as jobs,
           coalesce(sum(j.total_pages), 0)::int as pages,
           coalesce(sum(j.copies), 0)::int as copies,
           coalesce(sum(j.amount_cents), 0)::bigint as revenue
    from kiosks k
    left join print_jobs j on j.kiosk_id = k.id and j.success
         and j.printed_at >= now() - make_interval(days => ${days})
    where (${all}::boolean or k.id = any(${ids}::bigint[]))
    group by k.id order by revenue desc, jobs desc`;
}

export async function recentJobs(scope: Scope, limit = 20) {
  const [all, ids] = scopeParams(scope);
  return sql`
    select j.*, k.name as kiosk_name
    from print_jobs j join kiosks k on k.id = j.kiosk_id
    where (${all}::boolean or j.kiosk_id = any(${ids}::bigint[]))
    order by j.printed_at desc limit ${limit}`;
}
