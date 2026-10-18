import { and, eq } from "drizzle-orm";
import { cases, screeningHits } from "@/db/schema";
import { recalculateEdd } from "@/engine";
import { audit } from "@/lib/audit";
import { scoreCase, type CaseRow, type IdentityData, type QuestionnaireData } from "@/portal/cases";
import { recordDecision } from "@/portal/decision";
import type { PortalDeps } from "@/portal/deps";
import { PortalError } from "@/portal/errors";
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

function requireAllowed(deps: PortalDeps, caseId: string, action: Action) {
  const { c, hits } = load(deps, caseId);
  const a = availableActions(guardInput(c, hits))[action];
  if (!a.allowed) throw new PortalError("NOT_EDITABLE", a.why ?? "Not allowed.");
  return { c, hits };
}

const requireReason = (reason: string) => {
  if (!reason.trim()) throw new PortalError("VALIDATION", "A reason is required.", { reason: ["A reason is required"] });
  return reason.trim();
};

export function startReview(deps: PortalDeps, caseId: string, analystId: string) {
  requireAllowed(deps, caseId, "start_review");
  deps.db.update(cases).set({ status: "in_review", updatedAt: deps.now().toISOString() }).where(eq(cases.id, caseId)).run();
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
    const { risk, threshold, engineVersions } = scoreCase(deps, c, { pepConfirmed: true });
    deps.db.update(cases).set({ riskResult: risk, thresholdResult: threshold, engineVersions, updatedAt: now }).where(eq(cases.id, caseId)).run();
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

/** D8 "Have further questions": EDD asks for proof of source of funds and, unless the selfie already covered it, extra KYC (spec 05). */
export function requestEdd(deps: PortalDeps, caseId: string, reason: string, analystId: string) {
  const why = requireReason(reason);
  const { c } = requireAllowed(deps, caseId, "request_edd");
  const identity = c.identity as IdentityData | null;
  const request: EddRequest = {
    requestedAt: deps.now().toISOString(),
    requestedBy: `analyst:${analystId}`,
    reason: why,
    items: { sourceOfFunds: "required", extraKyc: identity?.selfie === "passed" ? "already_satisfied" : "required" },
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
  const q = c.questionnaire as QuestionnaireData;
  const result = recalculateEdd(
    {
      source_of_funds: q.source_of_funds,
      only_source_of_wealth: q.onlySourceOfWealth,
      documented_annual_amount: input.documentedAnnualAmount,
      deposited_to_date: input.depositedToDate,
    },
    deps.engine,
  );
  const record: EddResultRecord = { input, result, by: `analyst:${analystId}`, at: deps.now().toISOString() };
  deps.db.update(cases).set({ eddResult: record, updatedAt: deps.now().toISOString() }).where(eq(cases.id, caseId)).run();
  audit(deps.db, deps.now(), "engine", "engine.edd_recalculated", `case:${caseId}`, { input, result, enteredBy: `analyst:${analystId}` });
  return result;
}
