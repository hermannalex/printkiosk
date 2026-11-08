import Link from "next/link";
import { logout } from "@/app/actions";
import type { User } from "@/lib/auth";
import type { KioskStatus } from "@/lib/kiosks";
import { STATUS_LABEL } from "@/lib/kiosks";

function PrinterMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" />
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
        ]
      : [
          ["/painel", "Visão geral"],
          ["/painel/quiosques", "Quiosques e assinatura"],
        ];
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href={area === "master" ? "/master" : "/painel"} className="brand">
            <span className="brand-mark"><PrinterMark /></span>
            <span>
              PrintKiosk <small>{area === "master" ? "Master" : "Painel"}</small>
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
