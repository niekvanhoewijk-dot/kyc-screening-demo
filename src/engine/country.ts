import type { CountryRisk, EngineConfig, PolicySettings } from "./config";

// Resolution order from docs/spec/04 section 2 (first match wins), with the policy settings of spec 08 3.3:
// call-for-action entries resolve by call_for_action_treatment; recently delisted countries are held at
// Auto-High when recently_delisted_treatment = hold_auto_high.

export const COUNTRY_REASON_CODES = [
  "RC_COUNTRY_CALL_FOR_ACTION_COUNTERMEASURES",
  "RC_COUNTRY_CALL_FOR_ACTION_EDD",
  "RC_COUNTRY_INCREASED_MONITORING",
  "RC_COUNTRY_EU_SANCTIONS_MAP",
  "RC_COUNTRY_RECENTLY_DELISTED",
  "RC_COUNTRY_RECENTLY_DELISTED_HELD",
  "RC_COUNTRY_UNASSESSED",
  "RC_COUNTRY_DEMO_SEED_LOW",
] as const;
export type CountryReasonCode = (typeof COUNTRY_REASON_CODES)[number];

type ListName = "fatf_call_for_action" | "fatf_increased_monitoring" | "eu_sanctions_map" | "recently_delisted" | "demo_seed_low";

export type CountryResolution = {
  code: string;
  tier: string;
  list: ListName | "default";
  source: string;
  as_of: string;
  list_version: string;
  /** True when no list matched and the conservative default tier applied. */
  unassessed: boolean;
  reason_code: CountryReasonCode;
  /** Policy the resolution was made under; null for configs without a policy (direct test configs). */
  policy_id: string | null;
};

/** Seam for a real country-risk feed (CountryRiskProvider); the config-backed resolver is the default. */
export type CountryRiskLookup = (code: string) => CountryResolution;

/** Full v3 behaviour, used only when a config carries no policy (configs built directly in tests). */
const FULL_V3: Pick<PolicySettings, "call_for_action_treatment" | "recently_delisted_treatment"> = {
  call_for_action_treatment: "all_prohibited",
  recently_delisted_treatment: "normal_with_note",
};

const entry = (countries: CountryRisk, list: ListName, iso: string) => countries[list].find((c) => c.code === iso);

export function resolveCountry(code: string, config: EngineConfig): CountryResolution {
  const { countries } = config;
  const settings = config.policy?.settings ?? FULL_V3;
  const iso = code.trim().toUpperCase();
  const base = { code: iso, as_of: countries.meta.as_of, list_version: countries.meta.list_version, policy_id: config.policy?.id ?? null, unassessed: false };

  const cfa = entry(countries, "fatf_call_for_action", iso);
  if (cfa) {
    // Entries without an action are treated as countermeasures (the stricter reading).
    const edd = cfa.action === "edd";
    const accepted = edd && settings.call_for_action_treatment === "follow_fatf";
    return {
      ...base,
      tier: accepted ? "auto_high" : "prohibited",
      list: "fatf_call_for_action",
      source: edd ? "FATF call for action (enhanced due diligence)" : "FATF call for action (countermeasures)",
      reason_code: edd ? "RC_COUNTRY_CALL_FOR_ACTION_EDD" : "RC_COUNTRY_CALL_FOR_ACTION_COUNTERMEASURES",
    };
  }
  if (entry(countries, "fatf_increased_monitoring", iso))
    return { ...base, tier: "auto_high", list: "fatf_increased_monitoring", source: "FATF increased monitoring", reason_code: "RC_COUNTRY_INCREASED_MONITORING" };
  if (entry(countries, "eu_sanctions_map", iso))
    return { ...base, tier: "auto_high", list: "eu_sanctions_map", source: "EU sanctions map", reason_code: "RC_COUNTRY_EU_SANCTIONS_MAP" };
  const delisted = entry(countries, "recently_delisted", iso);
  if (delisted && settings.recently_delisted_treatment === "hold_auto_high")
    return { ...base, tier: "auto_high", list: "recently_delisted", source: `Recently delisted (${delisted.removed ?? "date unknown"}), held at Auto-High by policy`, reason_code: "RC_COUNTRY_RECENTLY_DELISTED_HELD" };
  if (entry(countries, "demo_seed_low", iso))
    return { ...base, tier: "low", list: "demo_seed_low", source: "Demo seed (placeholder, not a real assessment)", reason_code: "RC_COUNTRY_DEMO_SEED_LOW" };
  return {
    ...base,
    tier: countries.default_tier,
    list: "default",
    source: delisted ? `Recently delisted (${delisted.removed ?? "date unknown"}): default tier, analyst note` : "Unassessed (default tier)",
    unassessed: true,
    reason_code: delisted ? "RC_COUNTRY_RECENTLY_DELISTED" : "RC_COUNTRY_UNASSESSED",
  };
}
