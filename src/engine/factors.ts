import type { EngineConfig } from "./config";

export const SCORED_FACTORS = [
  "deposit_12m",
  "source_of_funds",
  "employment_status",
  "occupation_industry",
  "annual_income",
  "net_worth",
] as const;
export type ScoredFactor = (typeof SCORED_FACTORS)[number];

export function factorTier(factor: ScoredFactor, answerId: string, config: EngineConfig): string {
  const spec = config.matrix.factors[factor];
  if (!Array.isArray(spec)) {
    // occupation_industry: open list, unknown answers take the default tier (O-5).
    return spec.values.find((v) => v.id === answerId)?.tier ?? spec.default_tier;
  }
  const hit = spec.find((v) => v.id === answerId);
  if (!hit) throw new Error(`Unknown answer for ${factor}: "${answerId}"`);
  return hit.tier;
}

export function amountBandMax(
  factor: "deposit_12m" | "annual_income" | "net_worth",
  bandId: string,
  config: EngineConfig,
): number | null {
  const hit = config.matrix.factors[factor].find((b) => b.id === bandId);
  if (!hit) throw new Error(`Unknown band for ${factor}: "${bandId}"`);
  return hit.max;
}

export function pointsFor(tier: string, config: EngineConfig): number {
  const points = config.matrix.points[tier];
  if (points === undefined) throw new Error(`No points configured for tier "${tier}"`);
  return points;
}

/** SoF share that may be deposited (docs/spec/04 section 5). */
export function sofPercent(sof: string, onlySourceOfWealth: boolean, config: EngineConfig): number {
  const p = config.matrix.threshold.sof_percent;
  if (sof === "investment") return onlySourceOfWealth ? p.investment_only_wealth : p.investment_not_only_wealth;
  if (sof === "inheritance") return onlySourceOfWealth ? p.inheritance_only_wealth : p.inheritance_not_only_wealth;
  if (sof in p) return p[sof as keyof typeof p];
  throw new Error(`No SoF percentage configured for "${sof}"`);
}
