import { z } from "zod";
import { scoreCompany } from "./company";
import { COUNTRY_REASON_CODES } from "./country";
import type { EddResult } from "./edd";
import type { KybConfig } from "./kyb-config";
import type { Policy } from "./policy";
import { scoreApplicant, type RejectedBeforeScoring, type ScoreResult } from "./scoring";
import { initialThreshold, type ThresholdResult } from "./threshold";

// Engine inputs, outcomes and reason codes (docs/spec/08 section 4). Shared by decision records and the lifecycle.
// Pure: no I/O. Inputs hold only what the engine used, never names or document text.

export const REASON_CODES = [
  ...COUNTRY_REASON_CODES,
  "RC_US_TAX_RESIDENT",
  "RC_PEP_FORCES_HIGH",
  "RC_BAND_PROHIBITED",
  "RC_BAND_EDD_REQUIRED",
  "RC_THRESHOLD_DEPOSIT_BAND",
  "RC_THRESHOLD_SOF_OF_INCOME",
  "RC_THRESHOLD_CATEGORY_CAP",
  "RC_THRESHOLD_HARD_CEILING",
  "RC_EDD_NEW_THRESHOLD",
  "RC_EDD_EXCESS_RETURNED",
  "RC_EDD_TERMINATED",
  "LC_POR_EXPIRY_NOTICE",
  "LC_POR_EXPIRED",
  "LC_REVIEW_DUE_EDD_ANNUAL",
  "LC_REVIEW_DUE_STANDARD_5Y",
  "LC_THRESHOLD_REACHED",
  "LC_CIRCUMSTANCE_CHANGE",
  "LC_POLICY_CHANGE_REVIEW",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

// ---------- Inputs (engine factors only) ----------

export const factorAnswersSchema = z.object({
  deposit_12m: z.string(),
  source_of_funds: z.string(),
  employment_status: z.string(),
  occupation_industry: z.string(),
  annual_income: z.string(),
  net_worth: z.string(),
});

/** A re-score caused by a policy change: a reject becomes analyst review (D13). */
const context = z.literal("policy_change").optional();

export const individualInputsSchema = z.object({
  type: z.literal("individual"),
  country: z.string(),
  factor_answers: factorAnswersSchema,
  /** Effective PEP status: declared, or confirmed by an analyst on a screening hit. */
  pep: z.boolean(),
  us_tax_resident: z.boolean(),
  only_source_of_wealth: z.boolean(),
  context,
});
export const companyInputsSchema = z.object({
  type: z.literal("company"),
  country_of_incorporation: z.string(),
  /** `ref` is an internal person id, never a name. */
  persons: z.array(z.object({ ref: z.string(), country_of_residence: z.string(), pep: z.boolean() })),
  context,
});
export const eddInputsSchema = z.object({
  type: z.literal("edd"),
  source_of_funds: z.string(),
  only_source_of_wealth: z.boolean(),
  documented_annual_amount: z.number().nullable(),
  deposited_to_date: z.number(),
});
export const subjectInputsSchema = z.discriminatedUnion("type", [individualInputsSchema, companyInputsSchema]);
export type IndividualInputs = z.infer<typeof individualInputsSchema>;
export type CompanyInputs = z.infer<typeof companyInputsSchema>;
export type SubjectInputs = z.infer<typeof subjectInputsSchema>;

// ---------- Outcome ----------

export const outcomeSchema = z.object({
  total: z.number().nullable().optional(),
  band: z.string().nullable().optional(),
  score_band: z.string().nullable().optional(),
  forced_by: z.string().optional(),
  edd_required: z.boolean().optional(),
  threshold: z.number().nullable().optional(),
  binding_limit: z.string().nullable().optional(),
  route: z.string().optional(),
  status_from: z.string().optional(),
  status_to: z.string().optional(),
  edd_outcome: z.string().optional(),
  amount: z.number().optional(),
  /** lifecycle.* records: the obligation that fell due. */
  obligation: z.object({ code: z.string(), due_on: z.string().nullable(), basis: z.string(), flag: z.string() }).optional(),
  /** policy.* records: counts and the subjects that change (summary record, spec 08 4.1). */
  summary: z.record(z.string(), z.number()).optional(),
  changes: z
    .array(z.object({ subject: z.string(), changed: z.array(z.string()), analyst_review: z.boolean(), band_before: z.string().nullable(), band_after: z.string().nullable() }))
    .optional(),
});
export type DecisionOutcome = z.infer<typeof outcomeSchema>;
export type Evaluated = { outcome: DecisionOutcome; reason_codes: ReasonCode[] };

const THRESHOLD_CODE = {
  deposit_band: "RC_THRESHOLD_DEPOSIT_BAND",
  sof_of_income: "RC_THRESHOLD_SOF_OF_INCOME",
  category_cap: "RC_THRESHOLD_CATEGORY_CAP",
  hard_ceiling: "RC_THRESHOLD_HARD_CEILING",
} as const satisfies Record<ThresholdResult["binding"], ReasonCode>;

const route = (r: { decision?: string; edd_required?: boolean }) => (r.decision === "reject" ? "reject" : r.edd_required ? "edd_required" : "standard");
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** Outcome and reason codes of an individual score (spec 04, 08 4.3). */
export function individualOutcome(risk: ScoreResult | RejectedBeforeScoring, threshold: ThresholdResult | null): Evaluated {
  if (!("total" in risk)) return { outcome: { total: null, band: null, edd_required: false, threshold: null, binding_limit: null, route: "reject" }, reason_codes: ["RC_US_TAX_RESIDENT"] };
  const codes: ReasonCode[] = [];
  if (risk.country) codes.push(risk.country.reason_code);
  if (risk.forced_by === "pep") codes.push("RC_PEP_FORCES_HIGH");
  if (risk.band === "prohibited") codes.push("RC_BAND_PROHIBITED");
  if (risk.edd_required) codes.push("RC_BAND_EDD_REQUIRED");
  if (threshold) codes.push(THRESHOLD_CODE[threshold.binding]);
  return {
    outcome: {
      total: risk.total,
      band: risk.band,
      score_band: risk.score_band,
      ...(risk.forced_by ? { forced_by: risk.forced_by } : {}),
      edd_required: risk.edd_required,
      threshold: threshold?.threshold ?? null,
      binding_limit: threshold?.binding ?? null,
      route: route(risk),
    },
    reason_codes: codes,
  };
}

export function companyOutcome(risk: ReturnType<typeof scoreCompany>): Evaluated {
  const codes: ReasonCode[] = uniq([risk.companyCountry.reason_code, ...risk.persons.map((p) => p.country.reason_code)]);
  if (risk.persons.some((p) => p.raisedBy === "pep")) codes.push("RC_PEP_FORCES_HIGH");
  if (risk.band === "prohibited") codes.push("RC_BAND_PROHIBITED");
  if (risk.edd_required) codes.push("RC_BAND_EDD_REQUIRED");
  return { outcome: { band: risk.band, edd_required: risk.edd_required, threshold: null, route: route(risk) }, reason_codes: codes };
}

export function eddOutcome(r: EddResult): Evaluated {
  if (r.outcome === "new_threshold") return { outcome: { edd_outcome: r.outcome, threshold: r.new_threshold, amount: r.headroom }, reason_codes: ["RC_EDD_NEW_THRESHOLD"] };
  if (r.outcome === "return_excess_and_block") return { outcome: { edd_outcome: r.outcome, amount: r.excess_to_return }, reason_codes: ["RC_EDD_EXCESS_RETURNED"] };
  return { outcome: { edd_outcome: r.outcome, amount: r.amount_to_return }, reason_codes: ["RC_EDD_TERMINATED"] };
}

/** Score and initial threshold of an individual under a policy. */
export function evaluateIndividual(inputs: Omit<IndividualInputs, "type">, policy: Policy): Evaluated {
  const risk = scoreApplicant({ country: inputs.country, pep: inputs.pep, us_tax_resident: inputs.us_tax_resident, ...inputs.factor_answers }, policy);
  const threshold =
    "total" in risk && !risk.decision
      ? initialThreshold(
          {
            deposit_12m: inputs.factor_answers.deposit_12m,
            source_of_funds: inputs.factor_answers.source_of_funds,
            only_source_of_wealth: inputs.only_source_of_wealth,
            employment_status: inputs.factor_answers.employment_status,
            annual_income: inputs.factor_answers.annual_income,
            band: risk.band,
          },
          policy,
        )
      : null;
  return individualOutcome(risk, threshold);
}

export function evaluateCompany(inputs: Omit<CompanyInputs, "type">, policy: Policy, kyb: KybConfig): Evaluated {
  return companyOutcome(
    scoreCompany(
      { countryOfIncorporation: inputs.country_of_incorporation, persons: inputs.persons.map((p) => ({ id: p.ref, name: p.ref, countryOfResidence: p.country_of_residence, pep: p.pep })) },
      policy,
      kyb,
    ),
  );
}

/**
 * D13: a policy change never rejects or closes an existing relationship. Where the new policy would reject,
 * the route becomes analyst review with LC_POLICY_CHANGE_REVIEW. Only a person closes a relationship.
 */
export function policyChangeRouting<T extends { route?: string }>(outcome: T, reason_codes: ReasonCode[]): { outcome: T; reason_codes: ReasonCode[]; review: boolean } {
  if (outcome.route !== "reject") return { outcome, reason_codes, review: false };
  return { outcome: { ...outcome, route: "analyst_review" }, reason_codes: [...reason_codes, "LC_POLICY_CHANGE_REVIEW"], review: true };
}

/** An individual or company score, with policy-change routing when the inputs say the re-score came from one. */
export function evaluateSubject(inputs: SubjectInputs, policy: Policy, kyb: KybConfig): Evaluated {
  const r = inputs.type === "individual" ? evaluateIndividual(inputs, policy) : evaluateCompany(inputs, policy, kyb);
  if (inputs.context !== "policy_change") return r;
  const routed = policyChangeRouting(r.outcome, r.reason_codes);
  return { outcome: routed.outcome, reason_codes: routed.reason_codes };
}
