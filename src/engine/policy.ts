import { z } from "zod";
import { canonicalJson, sha256Hex } from "./canonical";
import { CONFIG_DIR, parseEngineConfig, readConfigYaml, type EngineConfig, type PolicyMeta } from "./config";

// Versioned policy (docs/spec/08 section 3): an immutable bundle of risk matrix, country list and settings,
// identified by id and a content hash. Every number comes from config/policy/policies.yaml.

const isoDate = z.iso.date();

const settingsSchema = z.object({
  call_for_action_treatment: z.enum(["all_prohibited", "follow_fatf"]),
  recently_delisted_treatment: z.enum(["normal_with_note", "hold_auto_high"]),
  periodic_review: z.object({
    enabled: z.boolean(),
    regulatory_effective_from: isoDate,
    interval_months: z.object({ edd: z.number().int().positive(), standard: z.number().int().positive() }),
  }),
});
export const policySettingsSchema = settingsSchema;

export const policiesFileSchema = z
  .object({
    default_policy: z.string().min(1),
    legal_limits: z.object({ review_interval_max_months: z.object({ edd: z.number().int().positive(), standard: z.number().int().positive() }) }),
    policies: z
      .array(
        z.object({
          id: z.string().regex(/^[A-Za-z0-9_-]+$/),
          label: z.string().min(1),
          effective_from: isoDate,
          risk_matrix: z.string().min(1),
          country_list: z.string().min(1),
          settings: settingsSchema,
        }),
      )
      .min(1),
  })
  .superRefine((f, ctx) => {
    const ids = f.policies.map((p) => p.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "duplicate policy id" });
    if (!ids.includes(f.default_policy)) ctx.addIssue({ code: "custom", message: `default_policy "${f.default_policy}" is not defined` });
    const max = f.legal_limits.review_interval_max_months;
    for (const p of f.policies) checkIntervals(p.settings.periodic_review.interval_months, max, (m) => ctx.addIssue({ code: "custom", message: `${p.id}: ${m}` }));
  });

/** AMLR Art. 26(2) outer limits: a policy may review more often, never less often. */
export function checkIntervals(i: { edd: number; standard: number }, max: { edd: number; standard: number }, fail: (m: string) => void) {
  if (i.edd > max.edd) fail(`periodic_review.interval_months.edd ${i.edd} exceeds the legal maximum ${max.edd}`);
  if (i.standard > max.standard) fail(`periodic_review.interval_months.standard ${i.standard} exceeds the legal maximum ${max.standard}`);
}

export type Policy = EngineConfig & { policy: PolicyMeta };
export type PolicySet = {
  all: Policy[];
  default: Policy;
  legalLimits: { review_interval_max_months: { edd: number; standard: number } };
  byId(id: string): Policy;
  /** The policy in force on a date (latest effective_from on or before it). */
  inForce(isoDateTime: string): Policy;
};

/** Content hash over everything the policy resolves to. Same content, same hash; any change, new hash. */
export function policyHash(engine: EngineConfig, settings: PolicyMeta["settings"]): string {
  return sha256Hex(canonicalJson({ risk_matrix: engine.matrix, country_list: engine.countries, settings }));
}

export function buildPolicy(engine: EngineConfig, meta: Omit<PolicyMeta, "hash">): Policy {
  return { ...engine, policy: { ...meta, hash: policyHash(engine, meta.settings) } };
}

/** A draft (simulator) version: same bundle, changed settings, new hash. Never mutates a published policy. */
export function draftPolicy(base: Policy, settings: Partial<PolicyMeta["settings"]>, id = `${base.policy.id}-draft`): Policy {
  const merged = settingsSchema.parse({ ...base.policy.settings, ...settings });
  return buildPolicy({ matrix: base.matrix, countries: base.countries }, { id, label: `${base.policy.label} (draft)`, effective_from: base.policy.effective_from, settings: merged });
}

export function parsePolicies(rawFile: unknown, read: (file: string) => unknown): PolicySet {
  const file = policiesFileSchema.parse(rawFile);
  const all = file.policies.map((p) =>
    buildPolicy(parseEngineConfig(read(p.risk_matrix), read(p.country_list)), { id: p.id, label: p.label, effective_from: p.effective_from, settings: p.settings }),
  );
  const byId = (id: string) => {
    const hit = all.find((p) => p.policy.id === id);
    if (!hit) throw new Error(`Unknown policy "${id}"`);
    return hit;
  };
  const sorted = [...all].sort((a, b) => a.policy.effective_from.localeCompare(b.policy.effective_from));
  return {
    all,
    default: byId(file.default_policy),
    legalLimits: file.legal_limits,
    byId,
    inForce(at: string) {
      const day = at.slice(0, "yyyy-mm-dd".length);
      const current = sorted.filter((p) => p.policy.effective_from <= day).at(-1);
      return current ?? sorted[0]!;
    },
  };
}

let cached: { dir: string; set: PolicySet } | undefined;

export function loadPolicies(configDir = CONFIG_DIR()): PolicySet {
  if (cached?.dir === configDir) return cached.set;
  const set = parsePolicies(readConfigYaml(configDir, "policy/policies.yaml"), (f) => readConfigYaml(configDir, f));
  cached = { dir: configDir, set };
  return set;
}

/**
 * The default policy (`default_policy` in policies.yaml, P1): the June 2026 list and Full v3 settings.
 * Used by tests, the oracle comparison and labels. Scoring in the app uses the policy in force.
 */
export function loadEngineConfig(configDir?: string): Policy {
  return loadPolicies(configDir).default;
}
