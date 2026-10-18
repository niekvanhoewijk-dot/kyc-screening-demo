import type { EngineConfig } from "./config";
import { resolveCountry, type CountryResolution } from "./country";
import type { KybConfig } from "./kyb-config";

export type CompanyScoreInput = {
  countryOfIncorporation: string;
  persons: { id: string; name: string; countryOfResidence: string; pep: boolean }[];
};

export type PersonBand = { id: string; name: string; band: string; country: CountryResolution; raisedBy?: "pep" };

export type CompanyScore = {
  band: string;
  /** What set the band: the company's country or a named person. */
  driver: { kind: "company_country" } | { kind: "person"; id: string; name: string };
  companyCountry: CountryResolution;
  companyCountryBand: string;
  persons: PersonBand[];
  edd_required: boolean;
  decision?: "reject";
  reason?: "prohibited_band";
  basis: "demo_default_o8";
};

/**
 * DEMO DEFAULT for company risk (spec 03, O-8): the requirements define no company factors.
 * Band = highest of the country-of-incorporation band and every natural person's band.
 */
export function scoreCompany(input: CompanyScoreInput, config: EngineConfig, kyb: KybConfig): CompanyScore {
  const order = config.matrix.bands.map((b) => b.id);
  const rank = (band: string) => {
    const i = order.indexOf(band);
    if (i < 0) throw new Error(`Unknown band "${band}" in kyb.yaml`);
    return i;
  };
  const bandForTier = (tier: string) => {
    const band = kyb.country_tier_to_band[tier];
    if (!band) throw new Error(`No band mapped for country tier "${tier}" in kyb.yaml`);
    rank(band);
    return band;
  };

  const companyCountry = resolveCountry(input.countryOfIncorporation, config);
  const companyCountryBand = bandForTier(companyCountry.tier);
  const persons: PersonBand[] = input.persons.map((p) => {
    const country = resolveCountry(p.countryOfResidence, config);
    const base = bandForTier(country.tier);
    const raise = p.pep && rank(base) < rank(kyb.pep_min_band);
    return { id: p.id, name: p.name, country, band: raise ? kyb.pep_min_band : base, ...(raise ? { raisedBy: "pep" as const } : {}) };
  });

  let band = companyCountryBand;
  let driver: CompanyScore["driver"] = { kind: "company_country" };
  for (const p of persons)
    if (rank(p.band) > rank(band)) {
      band = p.band;
      driver = { kind: "person", id: p.id, name: p.name };
    }

  const result: CompanyScore = { band, driver, companyCountry, companyCountryBand, persons, edd_required: false, basis: "demo_default_o8" };
  if (band === "prohibited") return { ...result, decision: "reject", reason: "prohibited_band" };
  if (band === "high" || band === "auto_high") result.edd_required = true;
  return result;
}
