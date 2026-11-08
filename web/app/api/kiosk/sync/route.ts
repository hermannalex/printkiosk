import { NextResponse } from "next/server";
import { one, sql } from "@/lib/db";
import { isoOf, todayIso } from "@/lib/format";
import { hashSecret, normalizeStoreCode } from "@/lib/license";

export const dynamic = "force-dynamic";

type Job = {
  id?: string;
  printedAt?: string;
  items?: number;
  pages?: number;
  copies?: number;
  totalPages?: number;
  amountCents?: number;
  paidWithPix?: boolean;
  pixPaymentId?: string | null;
  success?: boolean;
  demo?: boolean;
};

const int = (value: unknown, max = 1_000_000) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(n, max)) : 0;
};

/**
 * Called by the kiosk app on launch, every 30 minutes and after each print.
 * Registers the kiosk, stores the print jobs it sends, and returns the newest
 * activation code so a paid month reaches the kiosk without anyone typing it.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const storeCode = normalizeStoreCode(String(body?.storeCode ?? ""));
  const secret = String(body?.secret ?? "");
  if (!storeCode || secret.length < 16) {
    return NextResponse.json({ error: "Dados do quiosque inválidos." }, { status: 400 });
  }

  const secretHash = hashSecret(secret);
  let kiosk = await one`select id, secret_hash, plan from kiosks where store_code = ${storeCode}`;
  if (!kiosk) {
    kiosk = await one`insert into kiosks (store_code, secret_hash) values (${storeCode}, ${secretHash})
                      on conflict (store_code) do update set store_code = excluded.store_code
                      returning id, secret_hash, plan`;
  } else if (!kiosk.secret_hash) {
    // Registered from the dashboard before the kiosk ever connected: bind this device now.
    await sql`update kiosks set secret_hash = ${secretHash} where id = ${kiosk.id}`;
    kiosk.secret_hash = secretHash;
  }
  if (!kiosk || kiosk.secret_hash !== secretHash) {
    return NextResponse.json({ error: "Este código de loja pertence a outro aparelho." }, { status: 403 });
  }

  const kioskId = Number(kiosk.id);
  await sql`update kiosks set
      platform = ${String(body?.platform ?? "").slice(0, 20) || null},
      app_version = ${String(body?.appVersion ?? "").slice(0, 20) || null},
      license_state = ${String(body?.licenseState ?? "").slice(0, 20) || null},
      demo_remaining = ${body?.demoRemaining == null ? null : int(body.demoRemaining, 100)},
      last_seen_at = now()
    where id = ${kioskId}`;

  const jobs: Job[] = Array.isArray(body?.jobs) ? body.jobs.slice(0, 200) : [];
  let accepted: string[] = [];
  for (const job of jobs) {
    const clientId = String(job.id ?? "").slice(0, 64);
    const printedAt = new Date(String(job.printedAt ?? ""));
    if (!clientId || Number.isNaN(printedAt.getTime())) continue;
    await sql`insert into print_jobs
        (kiosk_id, client_id, printed_at, items, pages, copies, total_pages, amount_cents,
         paid_with_pix, pix_payment_id, success, demo)
      values (${kioskId}, ${clientId}, ${printedAt.toISOString()}, ${int(job.items, 1000)}, ${int(job.pages, 100000)},
              ${int(job.copies, 1000)}, ${int(job.totalPages)}, ${int(job.amountCents, 100_000_00)},
              ${!!job.paidWithPix}, ${job.pixPaymentId ? String(job.pixPaymentId).slice(0, 40) : null},
              ${job.success !== false}, ${!!job.demo})
      on conflict (kiosk_id, client_id) do nothing`;
    accepted.push(clientId);
  }

  const code = await one`select code, valid_until from activation_codes
                         where kiosk_id = ${kioskId} and valid_until >= ${todayIso()}
                         order by valid_until desc, id desc limit 1`;

  return NextResponse.json({
    accepted,
    activationCode: code?.code ?? null,
    validUntil: code ? isoOf(code.valid_until) : null,
    plan: kiosk.plan,
    dashboardUrl: process.env.APP_URL ?? null,
  });
}
