import type { EngineConfig } from "./config";

// Resolution order from docs/spec/04 section 2: first match wins.
const RESOLUTION = [
  { list: "fatf_call_for_action", tier: "prohibited", source: "FATF call for action" },
  { list: "fatf_increased_monitoring", tier: "auto_high", source: "FATF increased monitoring" },
  { list: "eu_sanctions_map", tier: "auto_high", source: "EU sanctions map" },
  { list: "demo_seed_low", tier: "low", source: "Demo seed (placeholder, not a real assessment)" },
] as const;

export type CountryResolution = {
  code: string;
  tier: string;
  list: (typeof RESOLUTION)[number]["list"] | "default";
  source: string;
  as_of: string;
  list_version: string;
  /** True when no list matched and the conservative default tier applied. */
  unassessed: boolean;
};

/** Seam for a real country-risk feed (CountryRiskProvider); the config-backed resolver is the default. */
export type CountryRiskLookup = (code: string) => CountryResolution;

export function resolveCountry(code: string, config: EngineConfig): CountryResolution {
  const { countries } = config;
  const iso = code.trim().toUpperCase();
  const base = { code: iso, as_of: countries.meta.as_of, list_version: countries.meta.list_version };
  for (const r of RESOLUTION)
    if (countries[r.list].some((c) => c.code === iso))
      return { ...base, tier: r.tier, list: r.list, source: r.source, unassessed: false };
  return {
    ...base,
    tier: countries.default_tier,
    list: "default",
    source: "Unassessed (default tier)",
    unassessed: true,
  };
}
