export type PlanId = "basic" | "pro";

export const PLANS: Record<PlanId, { name: string; cents: number; summary: string; features: string[] }> = {
  basic: {
    name: "Básico",
    cents: 2990,
    summary: "O app do quiosque liberado.",
    features: ["Impressões ilimitadas no quiosque", "Pix e envio pelo celular", "Renovação automática do código"],
  },
  pro: {
    name: "Pro",
    cents: 4990,
    summary: "O app + o dashboard da loja.",
    features: [
      "Tudo do Básico",
      "Faturamento e cópias por dia",
      "Estatísticas por quiosque e horário",
      "Histórico de impressões",
    ],
  },
};

export function planName(plan: string | null | undefined): string {
  return plan === "pro" ? PLANS.pro.name : PLANS.basic.name;
}
