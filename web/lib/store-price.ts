/**
 * Online store prices (Enterprise plan). Pure functions, used both by the server (the price that
 * counts) and by the customer's browser (the total shown while choosing options).
 *
 * Price of one file = pages × copies × price per page of the chosen size, in P&B or color,
 * plus each chosen extra: per page (× pages × copies), per copy (× copies) or once per file.
 */

export type ExtraUnit = "page" | "copy" | "file";

export type StoreSize = {
  id: string;
  name: string;
  enabled: boolean;
  /** Price per printed page in black and white, in cents; null = not offered. */
  pb: number | null;
  /** Price per printed page in color, in cents; null = not offered. */
  color: number | null;
};

export type StoreExtra = { id: string; name: string; enabled: boolean; cents: number; unit: ExtraUnit };

export type StoreConfig = { sizes: StoreSize[]; extras: StoreExtra[] };

export const UNIT_LABEL: Record<ExtraUnit, string> = {
  page: "por página",
  copy: "por cópia",
  file: "por arquivo",
};

export const MAX_COPIES = 100;
export const MAX_ORDER_FILES = 20;
export const MAX_PRICE_CENTS = 100_000; // R$ 1.000,00 for any one price in the table
export const MAX_ORDER_CENTS = 500_000; // R$ 5.000,00 per order

export const DEFAULT_STORE_CONFIG: StoreConfig = {
  sizes: [
    { id: "a4", name: "A4", enabled: true, pb: 50, color: 150 },
    { id: "oficio", name: "Ofício", enabled: false, pb: 60, color: 170 },
    { id: "a3", name: "A3", enabled: false, pb: 150, color: 400 },
    { id: "foto10x15", name: "Foto 10x15", enabled: false, pb: null, color: 250 },
  ],
  extras: [
    { id: "frente-verso", name: "Frente e verso", enabled: false, cents: 0, unit: "page" },
    { id: "papel-foto", name: "Papel fotográfico", enabled: false, cents: 200, unit: "page" },
    { id: "espiral", name: "Encadernação espiral", enabled: false, cents: 500, unit: "copy" },
  ],
};

const cleanName = (value: unknown, max = 40) =>
  String(value ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

const cents = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE_CENTS ? n : null;
};

export function slugId(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

/** Whatever is stored (or sent by a form) becomes a valid config: bad rows are dropped. */
export function sanitizeStoreConfig(raw: unknown): StoreConfig {
  const source = (raw && typeof raw === "object" ? raw : {}) as Partial<StoreConfig>;
  const sizes: StoreSize[] = [];
  for (const s of Array.isArray(source.sizes) ? source.sizes.slice(0, 20) : []) {
    const name = cleanName(s?.name);
    const id = slugId(String(s?.id || name));
    if (!name || !id || sizes.some((x) => x.id === id)) continue;
    const pb = cents(s?.pb);
    const color = cents(s?.color);
    if (pb === null && color === null) continue;
    sizes.push({ id, name, enabled: !!s?.enabled, pb, color });
  }
  const extras: StoreExtra[] = [];
  for (const e of Array.isArray(source.extras) ? source.extras.slice(0, 20) : []) {
    const name = cleanName(e?.name);
    const id = slugId(String(e?.id || name));
    const value = cents(e?.cents);
    if (!name || !id || value === null || extras.some((x) => x.id === id)) continue;
    const unit: ExtraUnit = e?.unit === "copy" || e?.unit === "file" ? e.unit : "page";
    extras.push({ id, name, enabled: !!e?.enabled, cents: value, unit });
  }
  if (!Array.isArray(source.sizes)) return DEFAULT_STORE_CONFIG;
  return { sizes, extras };
}

export function enabledSizes(config: StoreConfig): StoreSize[] {
  return config.sizes.filter((s) => s.enabled && (s.pb !== null || s.color !== null));
}

export function enabledExtras(config: StoreConfig): StoreExtra[] {
  return config.extras.filter((e) => e.enabled);
}

export type ItemChoice = { pages: number; paper: string; color: boolean; copies: number; extras: string[] };

/** Price of one file in cents, or an error message when the choice is not offered. */
export function priceItem(config: StoreConfig, item: ItemChoice): { cents: number } | { error: string } {
  const size = enabledSizes(config).find((s) => s.id === item.paper);
  if (!size) return { error: "Escolha um formato de papel." };
  const perPage = item.color ? size.color : size.pb;
  if (perPage === null) return { error: `${size.name} não é oferecido ${item.color ? "colorido" : "em preto e branco"}.` };
  const pages = Math.floor(item.pages);
  const copies = Math.floor(item.copies);
  if (!(pages >= 1 && pages <= 5000)) return { error: "Número de páginas inválido." };
  if (!(copies >= 1 && copies <= MAX_COPIES)) return { error: `Escolha de 1 a ${MAX_COPIES} cópias.` };
  let total = pages * copies * perPage;
  const offered = enabledExtras(config);
  const chosen = Array.from(new Set(item.extras));
  for (const id of chosen) {
    const extra = offered.find((e) => e.id === id);
    if (!extra) return { error: "Um adicional escolhido não está mais disponível." };
    total += extra.unit === "page" ? extra.cents * pages * copies : extra.unit === "copy" ? extra.cents * copies : extra.cents;
  }
  return { cents: total };
}

export function priceLabel(value: number | null): string {
  if (value === null) return "—";
  return (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
