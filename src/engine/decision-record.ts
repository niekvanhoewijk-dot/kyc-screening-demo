import { z } from "zod";
import { canonicalJson, sha256Hex } from "./canonical";
import { recalculateEdd } from "./edd";
import type { KybConfig } from "./kyb-config";
import { bookCustomerSchema, diffSubjects, evaluateLifecycle, type ObligationKind } from "./lifecycle";
import {
  eddInputsSchema,
  eddOutcome,
  evaluateSubject,
  outcomeSchema,
  REASON_CODES,
  subjectInputsSchema,
  companyInputsSchema,
  individualInputsSchema,
  type Evaluated,
} from "./outcomes";
import type { Policy, PolicySet } from "./policy";

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

// ---------- Inputs ----------

export const statusInputsSchema = z.object({ type: z.literal("status"), status_from: z.string() });
/** One obligation of a synthetic book customer: its facts, the simulated date and the POR rules in use. */
export const lifecycleInputsSchema = z.object({
  type: z.literal("lifecycle"),
  customer: bookCustomerSchema,
  as_of: z.iso.date(),
  rules: z.object({ por_notice_days: z.number(), por_validity_months: z.number() }),
  code: z.enum(REASON_CODES),
});
/** A policy change over a set of subjects. `record.policy` is the candidate; the baseline is named here. */
export const policyChangeInputsSchema = z.object({
  type: z.literal("policy_change"),
  baseline: z.object({ id: z.string(), hash: z.string() }),
  subjects: z.array(z.object({ subject: z.string(), inputs: subjectInputsSchema })),
});
export const decisionInputsSchema = z.discriminatedUnion("type", [
  individualInputsSchema,
  companyInputsSchema,
  eddInputsSchema,
  statusInputsSchema,
  lifecycleInputsSchema,
  policyChangeInputsSchema,
]);
export type DecisionInputs = z.infer<typeof decisionInputsSchema>;

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

const LIFECYCLE_KIND: Partial<Record<DecisionKind, ObligationKind>> = {
  "lifecycle.por_notice": "por_notice",
  "lifecycle.por_expired": "por_expired",
  "lifecycle.review_due": "review_due",
  "lifecycle.threshold_reached": "threshold_reached",
};

/** Record kind for an obligation kind (the simulator writes one record per obligation as it falls due). */
export const lifecycleRecordKind = (kind: ObligationKind) => `lifecycle.${kind}` as DecisionKind;

/** Looks up another policy a record names (the baseline of a policy change), drafts included. */
export type PolicyResolver = (id: string) => Policy;

/**
 * Runs the engine on a record's inputs. The single evaluation path for writing and replaying records.
 * `resolve` is needed only for policy.* records, which compare the record's policy with a baseline.
 */
export function evaluateDecision(kind: DecisionKind, inputs: DecisionInputs, policy: Policy, kyb: KybConfig, resolve?: PolicyResolver): Evaluated {
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
    if (inputs.type !== "individual" && inputs.type !== "company") throw new Error(`${kind} needs individual or company inputs`);
    const r = evaluateSubject(inputs, policy, kyb);
    const submitted = kind === "engine.score" ? { status_from: "draft", status_to: "submitted" } : {};
    return { outcome: { ...r.outcome, ...submitted }, reason_codes: r.reason_codes };
  }
  const obligationKind = LIFECYCLE_KIND[kind];
  if (obligationKind) {
    if (inputs.type !== "lifecycle") throw new Error(`${kind} needs lifecycle inputs`);
    const o = evaluateLifecycle(inputs.customer, policy, inputs.as_of, inputs.rules).find((x) => x.kind === obligationKind && x.code === inputs.code);
    if (!o) return { outcome: {}, reason_codes: [] };
    return {
      outcome: { obligation: { code: o.code, due_on: o.due_on, basis: o.basis, flag: o.flag }, ...(o.effect ? { status_to: o.effect.status } : {}), ...(o.effect && "route" in o.effect ? { route: o.effect.route } : {}) },
      reason_codes: [o.code],
    };
  }
  if (kind === "policy.dry_run" || kind === "policy.applied") {
    if (inputs.type !== "policy_change") throw new Error(`${kind} needs policy_change inputs`);
    if (!resolve) throw new Error(`${kind} needs a policy resolver for its baseline`);
    const diff = diffSubjects(inputs.subjects, resolve(inputs.baseline.id), policy, kyb);
    const changes = diff.rows
      .filter((r) => r.changed.length)
      .map((r) => ({ subject: r.subject, changed: r.changed, analyst_review: r.analyst_review, band_before: r.before.band, band_after: r.after.band }));
    return { outcome: { summary: diff.summary, changes }, reason_codes: changes.some((c) => c.analyst_review) ? ["LC_POLICY_CHANGE_REVIEW"] : [] };
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
  const policy = policies.byId(record.policy.id);
  const differences: string[] = [];
  if (policy.policy.hash !== record.policy.hash) differences.push(`policy ${record.policy.id} content changed since the record was written`);
  if (record.inputs.type === "policy_change") {
    const baseline = policies.byId(record.inputs.baseline.id);
    if (baseline.policy.hash !== record.inputs.baseline.hash) differences.push(`baseline policy ${baseline.policy.id} content changed since the record was written`);
  }
  const again = evaluateDecision(record.kind, record.inputs, policy, kyb, policies.byId);
  if (canonicalJson(again.outcome) !== canonicalJson(record.outcome)) differences.push(`outcome: recorded ${canonicalJson(record.outcome)}, replayed ${canonicalJson(again.outcome)}`);
  if (canonicalJson(again.reason_codes) !== canonicalJson(record.reason_codes)) differences.push(`reason codes: recorded ${record.reason_codes.join(",")}, replayed ${again.reason_codes.join(",")}`);
  return differences.length ? { reproduced: false, differences } : { reproduced: true };
}
