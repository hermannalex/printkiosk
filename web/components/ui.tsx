import Link from "next/link";
import { logout } from "@/app/actions";
import type { User } from "@/lib/auth";
import type { KioskStatus } from "@/lib/kiosks";
import { STATUS_LABEL } from "@/lib/kiosks";

/** The Quioco symbol: a sheet of paper whose bottom corner becomes the tail of the "q". */
export function QuiocoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 88 88" aria-hidden="true">
      <rect width="88" height="88" rx="22" fill="var(--accent)" />
      <g transform="translate(1,-3)">
        <path d="M26 14H52L66 28V62Q66 68 60 68H26Q20 68 20 62V20Q20 14 26 14Z" fill="#fff" />
        <path d="M52 14V24Q52 28 56 28H66Z" fill="#fff" fillOpacity="0.7" />
        <rect x="56" y="58" width="10" height="22" rx="5" fill="#fff" />
        <rect x="29" y="34" width="28" height="5" rx="2.5" fill="var(--accent)" />
        <rect x="29" y="44" width="28" height="5" rx="2.5" fill="var(--accent)" />
        <rect x="29" y="54" width="18" height="5" rx="2.5" fill="var(--accent)" />
      </g>
    </svg>
  );
}

export function Shell({
  user,
  area,
  current,
  children,
}: {
  user: User;
  area: "owner" | "master";
  current: string;
  children: React.ReactNode;
}) {
  const links =
    area === "master"
      ? [
          ["/master", "Visão geral"],
          ["/master/quiosques", "Quiosques"],
          ["/master/lojas", "Lojas"],
          ["/master/pagamentos", "Pagamentos"],
          ["/master/auditoria", "Auditoria"],
          ["/master/mercadopago", "Mercado Pago"],
          ["/master/backups", "Backups"],
        ]
      : [
          ["/painel", "Visão geral"],
          ["/painel/quiosques", "Quiosques e assinatura"],
          ["/painel/vouchers", "Vouchers"],
        ];
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href={area === "master" ? "/master" : "/painel"} className="brand">
            <QuiocoMark />
            <span>
              Quioco <small>{area === "master" ? "Master" : "Painel"}</small>
            </span>
          </Link>
          <nav className="nav" aria-label="Principal">
            {links.map(([href, label]) => (
              <Link key={href} href={href} aria-current={current === href ? "page" : undefined}>
                {label}
              </Link>
            ))}
            {user.role === "master" && area === "owner" && <Link href="/master">Master</Link>}
            {user.role === "master" && area === "master" && <Link href="/painel">Minha loja</Link>}
          </nav>
          <div className="user">
            <span>{user.name}</span>
            <Link href="/conta/seguranca" className="btn btn-sm">Segurança</Link>
            <form action={logout}>
              <button type="submit" className="btn btn-sm">Sair</button>
            </form>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}

export function Flash({ msg, erro }: { msg?: string; erro?: string }) {
  if (erro) return <div className="notice notice-err" role="alert">{erro}</div>;
  if (msg) return <div className="notice notice-ok" role="status">{msg}</div>;
  return null;
}

export function StatusPill({ status }: { status: KioskStatus }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function PlanPill({ plan }: { plan: string }) {
  return plan === "pro" ? <span className="pill pill-pro">Pro</span> : <span className="pill pill-never">Básico</span>;
}

export function Kpi({ label, value, foot, delta }: { label: string; value: string; foot?: string; delta?: number | null }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {(foot || delta != null) && (
        <span className="kpi-foot">
          {delta != null && Number.isFinite(delta) && (
            <span className={delta >= 0 ? "delta-up" : "delta-down"}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))}%{" "}
            </span>
          )}
          {foot}
        </span>
      )}
    </div>
  );
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}
