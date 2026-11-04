import { eq } from "drizzle-orm";
import { cases, type CASE_STATUSES } from "@/db/schema";
import {
  addDays,
  addMonths,
  applyEvent,
  customerInputs,
  diffSubjects,
  evaluateLifecycle,
  lifecycleEventSchema,
  lifecycleRecordKind,
  lifecycleRules,
  type DecisionRecord,
  type Obligation,
  type Policy,
  type PolicyDiff,
  type SubjectInputs,
} from "@/engine";
import { requireReason } from "@/console/actions";
import { audit } from "@/lib/audit";
import { scoreCase } from "@/portal/cases";
import { PortalError } from "@/portal/errors";
import type { PortalDeps } from "@/portal/deps";
import { appendRecord, recordsFor } from "@/records/store";
import { bookCustomer, bookCustomers, recordFacts, saveBookCustomer } from "./book";
import { resetSimClock, setSimDate, simClock, type SimClock } from "./clock";
import { effectivePolicy, policySet, resolvePolicy, setAppliedPolicy, type PolicyRef } from "./policies";

// Simulator service (docs/spec/08 sections 5.1, 5.4, 5.5). The rules engine decides; this module only feeds it
// the simulated date, injected facts and candidate policies, and writes what it decided as decision records.
// A policy change is a dry run by default, never rejects an existing customer (D13), and is undone by the demo reset.

/** Subject of the portfolio summary records (policy.dry_run, policy.applied). */
export const PORTFOLIO_SUBJECT = "portfolio";

/** Seeded cases that are not part of the book a policy change acts on. */
const OUT_OF_BOOK: (typeof CASE_STATUSES)[number][] = ["draft", "rejected"];

export type PortfolioSubject = { subject: string; source: "book" | "case"; inputs: SubjectInputs };

const policyMeta = (p: Policy) => ({ id: p.policy.id, label: p.policy.label, hash: p.policy.hash, settings: p.policy.settings, list_version: p.countries.meta.list_version, as_of: p.countries.meta.as_of });

/** The synthetic book plus the seeded cases, each with the engine inputs of its latest score. */
export function portfolio(deps: PortalDeps): PortfolioSubject[] {
  const book = bookCustomers(deps).map((c) => ({ subject: c.id, source: "book" as const, inputs: customerInputs(c) as SubjectInputs }));
  const seeded = deps.db
    .select()
    .from(cases)
    .all()
    .filter((c) => !OUT_OF_BOOK.includes(c.status))
    .flatMap((c) => {
      const score = recordsFor(deps, c.id).filter((r) => r.kind === "engine.score" || r.kind === "engine.rescore").at(-1);
      if (!score || (score.inputs.type !== "individual" && score.inputs.type !== "company")) return [];
      const { context: _context, ...inputs } = score.inputs;
      return [{ subject: c.id, source: "case" as const, inputs: inputs as SubjectInputs }];
    });
  return [...book, ...seeded];
}

const changeInputs = (subjects: PortfolioSubject[], baseline: Policy) => ({
  type: "policy_change" as const,
  baseline: { id: baseline.policy.id, hash: baseline.policy.hash },
  subjects: subjects.map((s) => ({ subject: s.subject, inputs: s.inputs })),
});

// ---------- Read-only view ----------

export type SimulatorView = {
  clock: SimClock;
  baseline: ReturnType<typeof policyMeta>;
  candidate: ReturnType<typeof policyMeta>;
  obligations: Obligation[];
  diff: PolicyDiff;
  sources: Record<string, PortfolioSubject["source"]>;
};

/** What the panel shows. Writes nothing. Obligations are for book customers, evaluated under the baseline. */
export function simulatorView(deps: PortalDeps, refs: { baseline?: PolicyRef; candidate?: PolicyRef } = {}): SimulatorView {
  const clock = simClock(deps);
  const baseline = refs.baseline ? resolvePolicy(deps, refs.baseline) : effectivePolicy(deps);
  const candidate = refs.candidate ? resolvePolicy(deps, refs.candidate) : baseline;
  const rules = lifecycleRules(deps.portal);
  const subjects = portfolio(deps);
  return {
    clock,
    baseline: policyMeta(baseline),
    candidate: policyMeta(candidate),
    obligations: bookCustomers(deps).flatMap((c) => evaluateLifecycle(c, baseline, clock.date, rules)),
    diff: diffSubjects(subjects, baseline, candidate, deps.kyb),
    sources: Object.fromEntries(subjects.map((s) => [s.subject, s.source])),
  };
}

// ---------- Policy change ----------

/** Dry run (D13 default): one policy.dry_run summary record, nothing else changes. */
export function dryRun(deps: PortalDeps, refs: { baseline?: PolicyRef; candidate: PolicyRef }, analystId: string): { record: DecisionRecord; diff: PolicyDiff } {
  const by = `analyst:${analystId}` as const;
  const baseline = refs.baseline ? resolvePolicy(deps, refs.baseline, { saveAs: by }) : effectivePolicy(deps);
  const candidate = resolvePolicy(deps, refs.candidate, { saveAs: by });
  const subjects = portfolio(deps);
  const record = appendRecord(deps, {
    subject: PORTFOLIO_SUBJECT,
    kind: "policy.dry_run",
    policy: candidate,
    inputs: changeInputs(subjects, baseline),
    decided_by: by,
    at_sim: simClock(deps).date,
    resolve: policySet(deps).byId,
  });
  audit(deps.db, deps.now(), by, "sim.dry_run", null, { baseline: baseline.policy.id, candidate: candidate.policy.id, summary: record.outcome.summary });
  return { record, diff: diffSubjects(subjects, baseline, candidate, deps.kyb) };
}

/**
 * "Apply to demo data": re-scores every subject the candidate changes and writes engine.rescore records pinned to it.
 * A customer the candidate would reject is routed to analyst review (D13), never closed. Seeded cases get the new
 * score on the case; book rows keep their facts and operative threshold (O-58). Undone by the demo reset.
 */
export function applyPolicy(deps: PortalDeps, refs: { baseline?: PolicyRef; candidate: PolicyRef }, reason: string, analystId: string) {
  const why = requireReason(reason);
  const by = `analyst:${analystId}` as const;
  const baseline = refs.baseline ? resolvePolicy(deps, refs.baseline, { saveAs: by }) : effectivePolicy(deps);
  const candidate = resolvePolicy(deps, refs.candidate, { saveAs: by });
  const at_sim = simClock(deps).date;
  const subjects = portfolio(deps);
  const diff = diffSubjects(subjects, baseline, candidate, deps.kyb);
  const changed = new Set(diff.rows.filter((r) => r.changed.length).map((r) => r.subject));

  for (const s of subjects.filter((x) => changed.has(x.subject))) {
    if (s.source === "case") {
      const c = deps.db.select().from(cases).where(eq(cases.id, s.subject)).get()!;
      const pepPersonIds = s.inputs.type === "company" ? s.inputs.persons.filter((p) => p.pep).map((p) => p.ref) : [];
      const scored = scoreCase(deps, c, { policy: candidate, pepConfirmed: s.inputs.type === "individual" && s.inputs.pep, pepPersonIds });
      deps.db.update(cases).set({ riskResult: scored.risk, thresholdResult: scored.threshold, engineVersions: scored.engineVersions, updatedAt: deps.now().toISOString() }).where(eq(cases.id, s.subject)).run();
    }
    const r = appendRecord(deps, { subject: s.subject, kind: "engine.rescore", policy: candidate, inputs: { ...s.inputs, context: "policy_change" }, decided_by: "engine", at_sim });
    audit(deps.db, deps.now(), "engine", "engine.rescored", s.source === "case" ? `case:${s.subject}` : `book:${s.subject}`, { cause: "policy_applied", policy: candidate.policy.id, outcome: r.outcome, reason_codes: r.reason_codes });
  }

  const record = appendRecord(deps, {
    subject: PORTFOLIO_SUBJECT,
    kind: "policy.applied",
    policy: candidate,
    inputs: changeInputs(subjects, baseline),
    decided_by: by,
    analyst_reason: why,
    at_sim,
    resolve: policySet(deps).byId,
  });
  setAppliedPolicy(deps, candidate, analystId);
  audit(deps.db, deps.now(), by, "sim.policy_applied", null, { baseline: baseline.policy.id, candidate: candidate.policy.id, reason: why, summary: record.outcome.summary });
  const recorded = recordDueObligations(deps, at_sim);
  return { record, diff, rescored: changed.size, recorded };
}

// ---------- Events and the clock ----------

/** Injects an event into a synthetic book customer's facts (spec 08 5.4) and records what the engine makes of it. */
export function injectEvent(deps: PortalDeps, subject: string, rawEvent: unknown, analystId: string) {
  const parsed = lifecycleEventSchema.safeParse(rawEvent);
  if (!parsed.success) throw new PortalError("VALIDATION", "Check the event fields.", { event: parsed.error.issues.map((i) => i.message) });
  const event = parsed.data;
  const before = bookCustomer(deps, subject);
  if (!before) throw new PortalError("NOT_FOUND", "Events apply to synthetic book customers only.");
  const clock = simClock(deps);
  const policy = effectivePolicy(deps);
  const rules = lifecycleRules(deps.portal);
  const after = applyEvent(before, event, { policy, rules });
  saveBookCustomer(deps, after);
  audit(deps.db, deps.now(), `analyst:${analystId}`, "sim.event_injected", `book:${subject}`, { event, at_sim: clock.date });

  if (event.type === "pep_confirmed" || event.type === "circumstance_change")
    appendRecord(deps, { subject, kind: "engine.rescore", policy, inputs: customerInputs(after), decided_by: "engine", at_sim: clock.date });
  if (event.type === "edd_outcome")
    appendRecord(deps, {
      subject,
      kind: "engine.edd",
      policy,
      inputs: { type: "edd", source_of_funds: before.factor_answers.source_of_funds, only_source_of_wealth: before.only_source_of_wealth, documented_annual_amount: event.documented_annual_amount, deposited_to_date: before.deposited_to_date },
      decided_by: "engine",
      at_sim: clock.date,
    });
  const recorded = recordDueObligations(deps, clock.date, [subject]);
  return { customer: after, obligations: evaluateLifecycle(after, policy, clock.date, rules), recorded };
}

export function moveClock(deps: PortalDeps, day: string, analystId: string) {
  const clock = setSimDate(deps, day, analystId);
  return { clock, recorded: recordDueObligations(deps, clock.date) };
}

export function advanceClock(deps: PortalDeps, step: { days?: number; months?: number }, analystId: string) {
  const from = simClock(deps).date;
  return moveClock(deps, step.months ? addMonths(from, step.months) : addDays(from, step.days ?? 0), analystId);
}

export function resetClock(deps: PortalDeps, analystId: string) {
  const clock = resetSimClock(deps, analystId);
  return { clock, recorded: recordDueObligations(deps, clock.date) };
}

const obligationKey = (code: string, dueOn: string | null, threshold: number | null) => `${code}|${dueOn ?? "now"}|${threshold ?? ""}`;

/**
 * Writes a lifecycle.* record for each obligation that falls due and has no record yet (the scheduler's job in a real
 * system). A threshold obligation is keyed on the threshold too, so reaching a raised threshold again is recorded.
 */
export function recordDueObligations(deps: PortalDeps, asOf: string, only?: string[]): number {
  const policy = effectivePolicy(deps);
  const rules = lifecycleRules(deps.portal);
  let written = 0;
  for (const c of bookCustomers(deps)) {
    if (only && !only.includes(c.id)) continue;
    const seen = new Set(
      recordsFor(deps, c.id).flatMap((r) =>
        r.inputs.type === "lifecycle" ? [obligationKey(r.inputs.code, r.outcome.obligation?.due_on ?? null, r.inputs.code === "LC_THRESHOLD_REACHED" ? r.inputs.customer.threshold : null)] : [],
      ),
    );
    for (const o of evaluateLifecycle(c, policy, asOf, rules)) {
      if (seen.has(obligationKey(o.code, o.due_on, o.kind === "threshold_reached" ? c.threshold : null))) continue;
      appendRecord(deps, { subject: c.id, kind: lifecycleRecordKind(o.kind), policy, inputs: { type: "lifecycle", customer: recordFacts(c), as_of: asOf, rules, code: o.code }, decided_by: "engine", at_sim: asOf });
      written++;
    }
  }
  return written;
}
