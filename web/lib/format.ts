const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const integer = new Intl.NumberFormat("pt-BR");

export const TZ = "America/Sao_Paulo";

export function brl(cents: number | string | null | undefined): string {
  return money.format(Number(cents ?? 0) / 100);
}

export function num(value: number | string | null | undefined): string {
  return integer.format(Number(value ?? 0));
}

export function dateBR(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return date.toLocaleDateString("pt-BR", { timeZone: TZ });
}

export function dateTimeBR(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
}

/** "há 5 min", "há 3 h", "há 2 dias" */
export function ago(value: string | Date | null | undefined): string {
  if (!value) return "nunca";
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 2) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} dias`;
}

/** Today in São Paulo as "YYYY-MM-DD". */
export function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Adds whole months to an ISO date, keeping the day where possible. */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function isoOf(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
