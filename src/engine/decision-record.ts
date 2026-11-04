import { z } from "zod";
import { canonicalJson, sha256Hex } from "./canonical";
import { scoreCompany } from "./company";
import { COUNTRY_REASON_CODES } from "./country";
import { recalculateEdd, type EddResult } from "./edd";
import type { KybConfig } from "./kyb-config";
import type { Policy, PolicySet } from "./policy";
import { scoreApplicant, type RejectedBeforeScoring, type ScoreResult } from "./scoring";
import { initialThreshold, type ThresholdResult } from "./threshold";

// Decision records (docs/spec/08 section 4): every outcome, by the engine or a person, as a replayable,
// hash-chained record. Pure: no I/O. Inputs hold only what the engine used, never names or document text.

export const DECISION_KINDS = [
  "engine.score",
  "engine.rescore",
  "engine.edd",
  "analyst.approve",
  "analyst.reject",
  "analyst.edd",
  "analyst.start_review",
  "applicant.edd_submitted",
  "lifecycle.por_notice",
  "lifecycle.por_expired",
  "lifecycle.review_due",
  "lifecycle.threshold_reached",
  "policy.dry_run",
  "policy.applied",
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

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

export const individualInputsSchema = z.object({
  type: z.literal("individual"),
  country: z.string(),
  factor_answers: factorAnswersSchema,
  /** Effective PEP status: declared, or confirmed by an analyst on a screening hit. */
  pep: z.boolean(),
  us_tax_resident: z.boolean(),
  only_source_of_wealth: z.boolean(),
});
export const companyInputsSchema = z.object({
  type: z.literal("company"),
  country_of_incorporation: z.string(),
  /** `ref` is an internal person id, never a name. */
  persons: z.array(z.object({ ref: z.string(), country_of_residence: z.string(), pep: z.boolean() })),
});
export const eddInputsSchema = z.object({
  type: z.literal("edd"),
  source_of_funds: z.string(),
  only_source_of_wealth: z.boolean(),
  documented_annual_amount: z.number().nullable(),
  deposited_to_date: z.number(),
});
export const statusInputsSchema = z.object({ type: z.literal("status"), status_from: z.string() });
export const decisionInputsSchema = z.discriminatedUnion("type", [individualInputsSchema, companyInputsSchema, eddInputsSchema, statusInputsSchema]);
export type DecisionInputs = z.infer<typeof decisionInputsSchema>;
export type IndividualInputs = z.infer<typeof individualInputsSchema>;
export type CompanyInputs = z.infer<typeof companyInputsSchema>;

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
});
export type DecisionOutcome = z.infer<typeof outcomeSchema>;

// ---------- Record ----------

export const decisionRecordSchema = z.object({
  id: z.string(),
  subject: z.string(),
  seq: z.number().int().positive(),
  kind: z.enum(DECISION_KINDS),
  policy: z.object({ id: z.string(), hash: z.string() }),
  inputs: decisionInputsSchema,
  outcome: outcomeSchema,
  reason_codes: z.array(z.enum(REASON_CODES)),
  decided_by: z.string().regex(/^(engine|applicant|analyst:[a-z\d-]+)$/),
  analyst_reason: z.string().optional(),
  at_wall: z.string(),
  at_sim: z.string().nullable(),
  prev_hash: z.string().nullable(),
  hash: z.string(),
});
export type DecisionRecord = z.infer<typeof decisionRecordSchema>;

/** Decision -> status (spec 01 case states, D8). Shared by recordDecision and replay. */
export const DECISION_STATUS = { approve: "approved", reject: "rejected", edd: "edd_requested" } as const;
const STATUS_KIND: Partial<Record<DecisionKind, string>> = {
  "analyst.approve": DECISION_STATUS.approve,
  "analyst.reject": DECISION_STATUS.reject,
  "analyst.edd": DECISION_STATUS.edd,
  "analyst.start_review": "in_review",
  "applicant.edd_submitted": "edd_submitted",
};

const THRESHOLD_CODE = {
  deposit_band: "RC_THRESHOLD_DEPOSIT_BAND",
  sof_of_income: "RC_THRESHOLD_SOF_OF_INCOME",
  category_cap: "RC_THRESHOLD_CATEGORY_CAP",
  hard_ceiling: "RC_THRESHOLD_HARD_CEILING",
} as const satisfies Record<ThresholdResult["binding"], ReasonCode>;

const route = (r: { decision?: string; edd_required?: boolean }) => (r.decision === "reject" ? "reject" : r.edd_required ? "edd_required" : "standard");
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** Outcome and reason codes of an individual score (spec 04, 08 4.3). */
export function individualOutcome(risk: ScoreResult | RejectedBeforeScoring, threshold: ThresholdResult | null): { outcome: DecisionOutcome; reason_codes: ReasonCode[] } {
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

export function companyOutcome(risk: ReturnType<typeof scoreCompany>): { outcome: DecisionOutcome; reason_codes: ReasonCode[] } {
  const codes: ReasonCode[] = uniq([risk.companyCountry.reason_code, ...risk.persons.map((p) => p.country.reason_code)]);
  if (risk.persons.some((p) => p.raisedBy === "pep")) codes.push("RC_PEP_FORCES_HIGH");
  if (risk.band === "prohibited") codes.push("RC_BAND_PROHIBITED");
  if (risk.edd_required) codes.push("RC_BAND_EDD_REQUIRED");
  return { outcome: { band: risk.band, edd_required: risk.edd_required, threshold: null, route: route(risk) }, reason_codes: codes };
}

export function eddOutcome(r: EddResult): { outcome: DecisionOutcome; reason_codes: ReasonCode[] } {
  if (r.outcome === "new_threshold") return { outcome: { edd_outcome: r.outcome, threshold: r.new_threshold, amount: r.headroom }, reason_codes: ["RC_EDD_NEW_THRESHOLD"] };
  if (r.outcome === "return_excess_and_block") return { outcome: { edd_outcome: r.outcome, amount: r.excess_to_return }, reason_codes: ["RC_EDD_EXCESS_RETURNED"] };
  return { outcome: { edd_outcome: r.outcome, amount: r.amount_to_return }, reason_codes: ["RC_EDD_TERMINATED"] };
}

/** Score and initial threshold of an individual under a policy. Shared by decision records and the lifecycle. */
export function evaluateIndividual(inputs: Omit<IndividualInputs, "type">, policy: Policy): { outcome: DecisionOutcome; reason_codes: ReasonCode[] } {
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

/** Runs the engine on a record's inputs. The single evaluation path for writing and replaying records. */
export function evaluateDecision(kind: DecisionKind, inputs: DecisionInputs, policy: Policy, kyb: KybConfig): { outcome: DecisionOutcome; reason_codes: ReasonCode[] } {
  const status = STATUS_KIND[kind];
  if (status) {
    if (inputs.type !== "status") throw new Error(`${kind} needs status inputs`);
    return { outcome: { status_from: inputs.status_from, status_to: status }, reason_codes: [] };
  }
  if (kind === "engine.edd") {
    if (inputs.type !== "edd") throw new Error("engine.edd needs edd inputs");
    return eddOutcome(
      recalculateEdd(
        { source_of_funds: inputs.source_of_funds, only_source_of_wealth: inputs.only_source_of_wealth, documented_annual_amount: inputs.documented_annual_amount, deposited_to_date: inputs.deposited_to_date },
        policy,
      ),
    );
  }
  if (kind === "engine.score" || kind === "engine.rescore") {
    const submitted = kind === "engine.score" ? { status_from: "draft", status_to: "submitted" } : {};
    if (inputs.type === "individual") {
      const r = evaluateIndividual(inputs, policy);
      return { outcome: { ...r.outcome, ...submitted }, reason_codes: r.reason_codes };
    }
    if (inputs.type === "company") {
      const r = companyOutcome(
        scoreCompany(
          { countryOfIncorporation: inputs.country_of_incorporation, persons: inputs.persons.map((p) => ({ id: p.ref, name: p.ref, countryOfResidence: p.country_of_residence, pep: p.pep })) },
          policy,
          kyb,
        ),
      );
      return { outcome: { ...r.outcome, ...submitted }, reason_codes: r.reason_codes };
    }
  }
  throw new Error(`No evaluation for ${kind} with ${inputs.type} inputs`);
}

// ---------- Hash chain ----------

export type RecordBody = Omit<DecisionRecord, "hash">;

export const recordHash = (body: RecordBody) => sha256Hex(canonicalJson(body));

export function sealRecord(body: RecordBody): DecisionRecord {
  return decisionRecordSchema.parse({ ...body, hash: recordHash(body) });
}

export type ChainProblem = { subject: string; seq: number; problem: string };

/** Recomputes every hash and link of one subject's records (sorted by seq). Empty = intact. */
export function verifyChain(records: DecisionRecord[]): ChainProblem[] {
  const problems: ChainProblem[] = [];
  const sorted = [...records].sort((a, b) => a.seq - b.seq);
  sorted.forEach((r, i) => {
    const { hash, ...body } = r;
    if (recordHash(body) !== hash) problems.push({ subject: r.subject, seq: r.seq, problem: "hash does not match the record content" });
    const prev = sorted[i - 1];
    if (r.seq !== (prev ? prev.seq + 1 : 1)) problems.push({ subject: r.subject, seq: r.seq, problem: "sequence gap" });
    if (r.prev_hash !== (prev?.hash ?? null)) problems.push({ subject: r.subject, seq: r.seq, problem: "prev_hash does not link to the previous record" });
  });
  return problems;
}

export type ReplayResult = { reproduced: true } | { reproduced: false; differences: string[] };

/** spec 08 4.4 (1): re-running a record under its pinned policy gives the same outcome and reason codes. */
export function replayRecord(record: DecisionRecord, policies: PolicySet, kyb: KybConfig): ReplayResult {
  if (record.kind === "policy.dry_run" || record.kind === "policy.applied" || record.kind.startsWith("lifecycle."))
    return { reproduced: false, differences: [`${record.kind} records are replayed by the lifecycle evaluator (Phase 8b)`] };
  const policy = policies.byId(record.policy.id);
  const differences: string[] = [];
  if (policy.policy.hash !== record.policy.hash) differences.push(`policy ${record.policy.id} content changed since the record was written`);
  const again = evaluateDecision(record.kind, record.inputs, policy, kyb);
  if (canonicalJson(again.outcome) !== canonicalJson(record.outcome)) differences.push(`outcome: recorded ${canonicalJson(record.outcome)}, replayed ${canonicalJson(again.outcome)}`);
  if (canonicalJson(again.reason_codes) !== canonicalJson(record.reason_codes)) differences.push(`reason codes: recorded ${record.reason_codes.join(",")}, replayed ${again.reason_codes.join(",")}`);
  return differences.length ? { reproduced: false, differences } : { reproduced: true };
}
