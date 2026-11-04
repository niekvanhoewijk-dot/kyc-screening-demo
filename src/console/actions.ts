import { and, eq } from "drizzle-orm";
import { cases, screeningHits } from "@/db/schema";
import { recalculateEdd } from "@/engine";
import { audit } from "@/lib/audit";
import { appendRecord } from "@/records/store";
import { scoreCase, type CaseRow, type IdentityData, type QuestionnaireData } from "@/portal/cases";
import { recordDecision } from "@/portal/decision";
import type { PortalDeps } from "@/portal/deps";
import { PortalError } from "@/portal/errors";
import { satisfiesExtraKyc } from "@/portal/evidence";
import { availableActions, type Action } from "./guards";

export type EddRequest = {
  requestedAt: string;
  requestedBy: string;
  reason: string;
  items: { sourceOfFunds: "required"; extraKyc: "required" | "already_satisfied" };
};
export type EddResultRecord = {
  input: { documentedAnnualAmount: number | null; depositedToDate: number };
  result: ReturnType<typeof recalculateEdd>;
  by: string;
  at: string;
};

function load(deps: PortalDeps, caseId: string) {
  const c = deps.db.select().from(cases).where(eq(cases.id, caseId)).get();
  if (!c) throw new PortalError("NOT_FOUND", "Case not found.");
  const hits = deps.db.select().from(screeningHits).where(eq(screeningHits.caseId, caseId)).all();
  return { c, hits };
}

export function guardInput(c: CaseRow, hits: { status: string; category: string }[]) {
  return {
    status: c.status,
    risk: c.riskResult as Parameters<typeof availableActions>[0]["risk"],
    eddResult: c.eddResult as EddResultRecord | null,
    hits,
  };
}

/** Policy in force on the wall clock (spec 08 5.5). */
const policyNow = (deps: PortalDeps) => deps.policies.inForce(deps.now().toISOString());

function requireAllowed(deps: PortalDeps, caseId: string, action: Action) {
  const { c, hits } = load(deps, caseId);
  const a = availableActions(guardInput(c, hits))[action];
  if (!a.allowed) throw new PortalError("NOT_EDITABLE", a.why ?? "Not allowed.");
  return { c, hits };
}

export const requireReason = (reason: string) => {
  if (!reason.trim()) throw new PortalError("VALIDATION", "A reason is required.", { reason: ["A reason is required"] });
  return reason.trim();
};

export function startReview(deps: PortalDeps, caseId: string, analystId: string) {
  const { c } = requireAllowed(deps, caseId, "start_review");
  deps.db.update(cases).set({ status: "in_review", updatedAt: deps.now().toISOString() }).where(eq(cases.id, caseId)).run();
  appendRecord(deps, { subject: caseId, kind: "analyst.start_review", policy: policyNow(deps), inputs: { type: "status", status_from: c.status }, decided_by: `analyst:${analystId}` });
  audit(deps.db, deps.now(), `analyst:${analystId}`, "case.review_started", `case:${caseId}`);
}

/** Analyst triage of a screening hit. Claude may explain a hit; only a person clears one (spec 02). */
export function triageHit(deps: PortalDeps, caseId: string, hitId: string, verdict: "false_positive" | "true_match", reason: string, analystId: string) {
  const why = requireReason(reason);
  const { c } = load(deps, caseId);
  if (c.status !== "in_review" && c.status !== "edd_submitted") throw new PortalError("NOT_EDITABLE", "Start the review first.");
  const hit = deps.db.select().from(screeningHits).where(and(eq(screeningHits.id, hitId), eq(screeningHits.caseId, caseId))).get();
  if (!hit) throw new PortalError("NOT_FOUND", "Screening hit not found.");
  const now = deps.now().toISOString();
  deps.db.update(screeningHits).set({ status: verdict, triagedBy: `analyst:${analystId}`, triageReason: why, triagedAt: now }).where(eq(screeningHits.id, hitId)).run();
  audit(deps.db, deps.now(), `analyst:${analystId}`, "screening.triaged", `case:${caseId}`, { hitId, entryId: hit.entryId, category: hit.category, from: hit.status, to: verdict, reason: why });

  // D9: a confirmed PEP match makes the client a PEP; the engine re-scores (band at least High).
  if (verdict === "true_match" && hit.category === "pep") {
    // Individual: the applicant is a PEP. Company: the matched person is (O-27).
    const confirmed = deps.db.select().from(screeningHits).where(eq(screeningHits.caseId, caseId)).all()
      .filter((h) => h.category === "pep" && (h.status === "true_match" || h.id === hitId) && h.subject && h.subject !== "company")
      .map((h) => h.subject!);
    const { risk, threshold, engineVersions, policy, inputs } = scoreCase(deps, c, { pepConfirmed: true, pepPersonIds: confirmed });
    deps.db.update(cases).set({ riskResult: risk, thresholdResult: threshold, engineVersions, updatedAt: now }).where(eq(cases.id, caseId)).run();
    appendRecord(deps, { subject: caseId, kind: "engine.rescore", policy, inputs, decided_by: "engine" });
    audit(deps.db, deps.now(), "engine", "engine.rescored", `case:${caseId}`, { cause: "pep_match_confirmed", hitId, risk, threshold });
  }
}

export function decide(deps: PortalDeps, caseId: string, action: "approve" | "reject", reason: string, analystId: string) {
  const why = requireReason(reason);
  const { c } = requireAllowed(deps, caseId, action);
  recordDecision(deps, caseId, action, why, analystId);
  // spec 05: the demo moves no money; a return of funds is an analyst-recorded instruction.
  const edd = c.eddResult as EddResultRecord | null;
  if (action === "reject" && edd && edd.result.outcome !== "new_threshold") {
    const r = edd.result;
    audit(deps.db, deps.now(), `analyst:${analystId}`, "funds.return_instruction", `case:${caseId}`, {
      outcome: r.outcome,
      amount: r.outcome === "return_all_and_terminate" ? r.amount_to_return : r.excess_to_return,
      report_to: r.report_to,
    });
  }
}

/** D8 "Have further questions": EDD asks for proof of source of funds and, unless the identity evidence already covered it (selfie passed; wallet per config, O-70), extra KYC (spec 05). */
export function requestEdd(deps: PortalDeps, caseId: string, reason: string, analystId: string) {
  const why = requireReason(reason);
  const { c } = requireAllowed(deps, caseId, "request_edd");
  const identity = c.identity as IdentityData | null;
  const request: EddRequest = {
    requestedAt: deps.now().toISOString(),
    requestedBy: `analyst:${analystId}`,
    reason: why,
    items: { sourceOfFunds: "required", extraKyc: satisfiesExtraKyc(identity, deps.wallet.config) ? "already_satisfied" : "required" },
  };
  recordDecision(deps, caseId, "edd", why, analystId);
  deps.db.update(cases).set({ eddRequest: request, eddSubmission: null, eddResult: null }).where(eq(cases.id, caseId)).run();
  audit(deps.db, deps.now(), `analyst:${analystId}`, "edd.requested", `case:${caseId}`, request.items);
}

/** spec 05 recalculation: the analyst enters what the SoF documents evidence; the engine computes the outcome. */
export function recalculateEddForCase(
  deps: PortalDeps,
  caseId: string,
  input: { documentedAnnualAmount: number | null; depositedToDate: number },
  analystId: string,
) {
  const { c } = requireAllowed(deps, caseId, "recalculate_edd");
  const bad = (n: number | null) => n !== null && (!Number.isInteger(n) || n < 0);
  if (bad(input.documentedAnnualAmount) || bad(input.depositedToDate))
    throw new PortalError("VALIDATION", "Amounts must be whole dollars, zero or more.");
  const q = c.questionnaire as QuestionnaireData | null;
  const company = c.company as { source_of_funds: string } | null;
  const eddInputs = {
    source_of_funds: q?.source_of_funds ?? company!.source_of_funds,
    only_source_of_wealth: q?.onlySourceOfWealth ?? false,
    documented_annual_amount: input.documentedAnnualAmount,
    deposited_to_date: input.depositedToDate,
  };
  const policy = policyNow(deps);
  const result = recalculateEdd(eddInputs, policy);
  appendRecord(deps, { subject: caseId, kind: "engine.edd", policy, inputs: { type: "edd", ...eddInputs }, decided_by: "engine" });
  const record: EddResultRecord = { input, result, by: `analyst:${analystId}`, at: deps.now().toISOString() };
  deps.db.update(cases).set({ eddResult: record, updatedAt: deps.now().toISOString() }).where(eq(cases.id, caseId)).run();
  audit(deps.db, deps.now(), "engine", "engine.edd_recalculated", `case:${caseId}`, { input, result, enteredBy: `analyst:${analystId}` });
  return result;
}
