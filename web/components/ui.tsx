import Link from "next/link";
import { logout } from "@/app/actions";
import type { User } from "@/lib/auth";
import type { KioskStatus } from "@/lib/kiosks";
import { STATUS_LABEL } from "@/lib/kiosks";

/** The imprime.ai symbol: a friendly printer that winks; the yellow dot is the ".ai". */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <rect width="120" height="120" rx="28" fill="#4F46E5" />
      <rect x="38" y="18" width="44" height="22" rx="4" fill="#C7D2FE" />
      <rect x="20" y="36" width="80" height="52" rx="16" fill="#fff" />
      <circle cx="46" cy="56" r="5" fill="#4F46E5" />
      <path d="M68 56h12" stroke="#4F46E5" strokeWidth="5" strokeLinecap="round" />
      <path d="M45 69q15 11 30 0" fill="none" stroke="#4F46E5" strokeWidth="5.5" strokeLinecap="round" />
      <rect x="34" y="86" width="52" height="14" rx="3" fill="#C7D2FE" />
      <circle cx="92" cy="94" r="7" fill="#FACC15" />
    </svg>
  );
}

/** "imprime" with the ".ai" in the brand color. */
export function Wordmark() {
  return <span className="wordmark">imprime<span>.ai</span></span>;
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
            <BrandMark />
            <span>
              <Wordmark /> <small>{area === "master" ? "Master" : "Painel"}</small>
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
