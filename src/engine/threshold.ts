import type { EngineConfig } from "./config";
import { amountBandMax, sofPercent } from "./factors";
import { floorDollars } from "./money";

export type ThresholdInput = {
  deposit_12m: string;
  source_of_funds: string;
  only_source_of_wealth?: boolean;
  employment_status: string;
  annual_income: string;
  /** Final band from scoreApplicant (after hard rules). */
  band: string;
};

export type ThresholdLimit = { kind: "deposit_band" | "sof_of_income" | "category_cap" | "hard_ceiling"; value: number };

export type ThresholdResult = {
  threshold: number;
  /** Every limit that applied; the smallest one binds. Open-ended bands contribute no limit. */
  limits: ThresholdLimit[];
  binding: ThresholdLimit["kind"];
};

/** Initial deposit threshold (docs/spec/04 section 5; formula inferred, see O-1). */
export function initialThreshold(input: ThresholdInput, config: EngineConfig): ThresholdResult {
  const t = config.matrix.threshold;
  const limits: ThresholdLimit[] = [];

  const depositMax = amountBandMax("deposit_12m", input.deposit_12m, config);
  if (depositMax !== null) limits.push({ kind: "deposit_band", value: depositMax });

  const incomeMax = amountBandMax("annual_income", input.annual_income, config);
  const pct = sofPercent(input.source_of_funds, input.only_source_of_wealth ?? false, config);
  if (incomeMax !== null) limits.push({ kind: "sof_of_income", value: pct * incomeMax });

  const caps = [t.caps.standard];
  if (t.restricted_employment.includes(input.employment_status)) caps.push(t.caps.restricted_employment);
  if (input.band === "high" || input.band === "auto_high") caps.push(t.caps.high_or_auto_high_band);
  limits.push({ kind: "category_cap", value: Math.min(...caps) });

  limits.push({ kind: "hard_ceiling", value: t.hard_ceiling_initial });

  const binding = limits.reduce((min, l) => (l.value < min.value ? l : min));
  return { threshold: floorDollars(binding.value), limits, binding: binding.kind };
}
