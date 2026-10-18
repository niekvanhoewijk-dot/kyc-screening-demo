import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

// Zod schemas for config/*.yaml. Every number the engine uses comes through here.

const amount = z.number().int().nonnegative();
const percent = z.number().gt(0).max(1);

const answer = z.object({ id: z.string().min(1), label: z.string().min(1), tier: z.string().min(1) });
const amountBand = answer.extend({ min: amount, max: amount.nullable() });

export const riskMatrixSchema = z
  .object({
    version: z.number().int(),
    points: z.record(z.string(), z.number().int().positive()),
    bands: z.array(z.object({ id: z.string().min(1), min: amount, max: amount.nullable() })).min(1),
    factors: z.object({
      deposit_12m: z.array(amountBand).min(1),
      source_of_funds: z.array(answer).min(1),
      employment_status: z.array(answer).min(1),
      occupation_industry: z.object({ default_tier: z.string(), values: z.array(answer) }),
      annual_income: z.array(amountBand).min(1),
      net_worth: z.array(amountBand).min(1),
    }),
    hard_rules: z.object({
      us_tax_resident: z.literal("reject"),
      pep: z.literal("force_band_high"),
      prohibited_band: z.literal("reject"),
      high_or_auto_high_band: z.literal("require_edd"),
    }),
    threshold: z.object({
      restricted_employment: z.array(z.string()),
      caps: z.object({ restricted_employment: amount, high_or_auto_high_band: amount, standard: amount }),
      hard_ceiling_initial: amount,
      sof_percent: z.object({
        salary: percent,
        savings: percent,
        investment_not_only_wealth: percent,
        investment_only_wealth: percent,
        inheritance_not_only_wealth: percent,
        inheritance_only_wealth: percent,
        pension: percent,
        other: percent,
      }),
      future_sof_percent: z.record(z.string(), percent).optional(),
    }),
  })
  .superRefine((m, ctx) => {
    const tiers = new Set(Object.keys(m.points));
    const checkTier = (tier: string, where: string) => {
      if (!tiers.has(tier)) ctx.addIssue({ code: "custom", message: `${where}: tier "${tier}" has no points` });
    };
    for (const [name, spec] of Object.entries(m.factors)) {
      const values = Array.isArray(spec) ? spec : spec.values;
      if (!Array.isArray(spec)) checkTier(spec.default_tier, `${name}.default_tier`);
      for (const v of values) checkTier(v.tier, `${name}.${v.id}`);
      const ids = values.map((v) => v.id);
      if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: `${name}: duplicate ids` });
    }
    // Bands must be ordered, contiguous and open-ended at the top so every total has exactly one band.
    m.bands.forEach((b, i) => {
      const next = m.bands[i + 1];
      if (b.max !== null && b.max < b.min) ctx.addIssue({ code: "custom", message: `band ${b.id}: max < min` });
      if (next && (b.max === null || next.min !== b.max + 1))
        ctx.addIssue({ code: "custom", message: `bands not contiguous between ${b.id} and ${next.id}` });
      if (!next && b.max !== null) ctx.addIssue({ code: "custom", message: "last band must be open-ended" });
    });
    // The hard rules and caps name these bands; they must exist.
    for (const id of ["high", "auto_high", "prohibited"])
      if (!m.bands.some((b) => b.id === id)) ctx.addIssue({ code: "custom", message: `missing band "${id}"` });
    const employment = new Set(m.factors.employment_status.map((e) => e.id));
    for (const id of m.threshold.restricted_employment)
      if (!employment.has(id)) ctx.addIssue({ code: "custom", message: `restricted_employment: unknown "${id}"` });
  });

const countryEntry = z.object({
  code: z.string().regex(/^[A-Z][A-Z]$/),
  name: z.string().min(1),
  added: z.string().optional(),
  removed: z.string().optional(),
});

export const COUNTRY_LISTS = [
  "fatf_call_for_action",
  "fatf_increased_monitoring",
  "eu_sanctions_map",
  "demo_seed_low",
  "recently_delisted",
] as const;

export const countryRiskSchema = z
  .object({
    meta: z.object({
      list_version: z.string().min(1),
      as_of: z.iso.date(),
      verified_on: z.iso.date().optional(),
      refresh_due: z.string().optional(),
      sources: z.array(z.url()).min(1),
    }),
    fatf_call_for_action: z.array(countryEntry),
    fatf_increased_monitoring: z.array(countryEntry),
    eu_sanctions_map: z.array(countryEntry),
    demo_seed_low: z.array(countryEntry),
    recently_delisted: z.array(countryEntry).default([]),
    default_tier: z.string().min(1),
  })
  .superRefine((c, ctx) => {
    // A country on two lists would make "first match wins" silently hide a data error.
    const seen = new Map<string, string>();
    for (const list of COUNTRY_LISTS)
      for (const { code } of c[list]) {
        const prev = seen.get(code);
        if (prev) ctx.addIssue({ code: "custom", message: `${code} appears in ${prev} and ${list}` });
        seen.set(code, list);
      }
  });

export type RiskMatrix = z.infer<typeof riskMatrixSchema>;
export type CountryRisk = z.infer<typeof countryRiskSchema>;
export type EngineConfig = { matrix: RiskMatrix; countries: CountryRisk };

export function parseEngineConfig(rawMatrix: unknown, rawCountries: unknown): EngineConfig {
  const matrix = riskMatrixSchema.parse(rawMatrix);
  const countries = countryRiskSchema.parse(rawCountries);
  if (!(countries.default_tier in matrix.points))
    throw new Error(`country-risk default_tier "${countries.default_tier}" has no points in risk-matrix`);
  return { matrix, countries };
}

let cached: EngineConfig | undefined;

/** Reads and validates config/*.yaml. Throws on any schema violation, so a bad config never scores. */
export function loadEngineConfig(configDir = path.resolve(process.cwd(), "config")): EngineConfig {
  if (cached && configDir === path.resolve(process.cwd(), "config")) return cached;
  const read = (f: string) => parse(fs.readFileSync(path.join(configDir, f), "utf8"));
  const config = parseEngineConfig(read("risk-matrix.yaml"), read("country-risk.yaml"));
  if (configDir === path.resolve(process.cwd(), "config")) cached = config;
  return config;
}
