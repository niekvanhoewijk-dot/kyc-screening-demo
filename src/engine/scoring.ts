import type { EngineConfig } from "./config";
import { resolveCountry, type CountryResolution, type CountryRiskLookup } from "./country";
import { factorTier, pointsFor, SCORED_FACTORS, type ScoredFactor } from "./factors";

export type ScoreInput = Record<ScoredFactor, string> & {
  country?: string;
  /** Test fixtures only (e.g. the doc's historic Albania example). */
  country_tier_override?: string;
  pep?: boolean;
  us_tax_resident?: boolean;
};

export type BreakdownLine = { factor: "country" | ScoredFactor; answer: string; tier: string; points: number };

export type RejectedBeforeScoring = { decision: "reject"; reason: "us_tax_resident" };

export type ScoreResult = {
  total: number;
  band: string;
  /** Band from the total alone, before hard rules. */
  score_band: string;
  forced_by?: "pep";
  breakdown: BreakdownLine[];
  country: CountryResolution | null;
  edd_required: boolean;
  decision?: "reject";
  reason?: "prohibited_band";
};

export function bandFor(total: number, config: EngineConfig): string {
  const band = config.matrix.bands.find((b) => total >= b.min && (b.max === null || total <= b.max));
  if (!band) throw new Error(`No band covers total ${total}`);
  return band.id;
}

const bandRank = (id: string, config: EngineConfig) => config.matrix.bands.findIndex((b) => b.id === id);

/** Deterministic client risk score and routing (docs/spec/04 sections 1-4). */
export function scoreApplicant(
  input: ScoreInput,
  config: EngineConfig,
  lookupCountry: CountryRiskLookup = (code) => resolveCountry(code, config),
): ScoreResult | RejectedBeforeScoring {
  if (input.us_tax_resident) return { decision: "reject", reason: "us_tax_resident" };

  let country: CountryResolution | null = null;
  let countryTier: string;
  if (input.country_tier_override) {
    countryTier = input.country_tier_override;
  } else {
    if (!input.country) throw new Error("country is required unless country_tier_override is set");
    country = lookupCountry(input.country);
    countryTier = country.tier;
  }

  const breakdown: BreakdownLine[] = [
    {
      factor: "country",
      answer: country?.code ?? "override",
      tier: countryTier,
      points: pointsFor(countryTier, config),
    },
    ...SCORED_FACTORS.map((factor) => {
      const tier = factorTier(factor, input[factor], config);
      return { factor, answer: input[factor], tier, points: pointsFor(tier, config) };
    }),
  ];

  const total = breakdown.reduce((sum, line) => sum + line.points, 0);
  const scoreBand = bandFor(total, config);
  const result: ScoreResult = { total, band: scoreBand, score_band: scoreBand, breakdown, country, edd_required: false };

  // D9: PEP = band at least High. Never lowers a higher band.
  if (input.pep && bandRank(scoreBand, config) < bandRank("high", config)) {
    result.band = "high";
    result.forced_by = "pep";
  }

  if (result.band === "prohibited") {
    result.decision = "reject";
    result.reason = "prohibited_band";
  } else if (result.band === "high" || result.band === "auto_high") {
    result.edd_required = true;
  }
  return result;
}
