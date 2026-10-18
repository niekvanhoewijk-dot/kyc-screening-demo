import { eq } from "drizzle-orm";
import { cases } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { PortalDeps } from "./deps";
import { PortalError } from "./errors";
import type { CaseRow } from "./cases";

export type Decision = "approve" | "reject" | "edd";
const NEXT_STATUS = { approve: "approved", reject: "rejected", edd: "edd_requested" } as const;
const DECIDABLE = new Set(["submitted", "in_review", "edd_submitted"]);

/** Human decision node (D8). Reason is mandatory. Call through src/console/actions.ts, which applies the guards. */
export function recordDecision(deps: PortalDeps, caseId: string, decision: Decision, reason: string, analystId: string) {
  const c = deps.db.select().from(cases).where(eq(cases.id, caseId)).get();
  if (!c) throw new PortalError("NOT_FOUND", "Case not found.");
  if (!DECIDABLE.has(c.status)) throw new PortalError("NOT_EDITABLE", `Case is ${c.status}; it cannot be decided now.`);
  if (!reason.trim()) throw new PortalError("VALIDATION", "A reason is required.", { reason: ["A reason is required"] });
  const now = deps.now().toISOString();
  deps.db
    .update(cases)
    .set({ status: NEXT_STATUS[decision], decision, decisionReason: reason.trim(), decidedBy: `analyst:${analystId}`, decidedAt: now, updatedAt: now })
    .where(eq(cases.id, caseId))
    .run();
  audit(deps.db, deps.now(), `analyst:${analystId}`, "case.decided", `case:${caseId}`, { decision, reason: reason.trim(), from: c.status });
}

export type ApplicantView =
  | { kind: "draft" }
  | { kind: "check" }
  | { kind: "confirmation"; threshold: number | null }
  | { kind: "no_go" }
  | { kind: "edd"; extraKyc: "required" | "already_satisfied" }
  | { kind: "por_expired" };

/** What the applicant sees. Never exposes score, band, screening or the decision reason (D7). */
export function applicantView(c: CaseRow): ApplicantView {
  switch (c.status) {
    case "draft":
      return { kind: "draft" };
    case "submitted":
    case "in_review":
    case "edd_submitted":
      return { kind: "check" };
    case "approved": {
      // After EDD the recalculated threshold replaces the initial one (spec 05, O-25).
      const edd = (c.eddResult as { result?: { outcome: string; new_threshold?: number } } | null)?.result;
      const initial = (c.thresholdResult as { threshold?: number } | null)?.threshold ?? null;
      return { kind: "confirmation", threshold: edd?.outcome === "new_threshold" ? (edd.new_threshold ?? initial) : initial };
    }
    case "rejected":
      return { kind: "no_go" };
    case "edd_requested":
      return { kind: "edd", extraKyc: (c.eddRequest as { items?: { extraKyc?: "required" | "already_satisfied" } } | null)?.items?.extraKyc ?? "required" };
    case "expired_por":
      return { kind: "por_expired" };
  }
}
