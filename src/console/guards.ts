// Which analyst actions are available for a case, and why not. Pure; reads engine output only.
// The engine decides what is possible (hard rules, EDD requirement); the analyst decides within it.

export type Action = "start_review" | "approve" | "request_edd" | "reject" | "recalculate_edd";
export type Availability = { allowed: boolean; why?: string };

export type GuardInput = {
  status: string;
  risk: { decision?: string; reason?: string; band?: string; edd_required?: boolean } | null;
  eddResult: { result: { outcome: string } } | null;
  hits: { status: string; category: string }[];
};

const no = (why: string): Availability => ({ allowed: false, why });
const yes: Availability = { allowed: true };

export function availableActions(c: GuardInput): Record<Action, Availability> {
  const reviewing = c.status === "in_review" || c.status === "edd_submitted";
  const engineReject = c.risk?.decision === "reject";
  const open = c.hits.filter((h) => h.status === "open").length;
  const confirmedSanctions = c.hits.some((h) => h.status === "true_match" && h.category === "sanctions");
  const eddOutcome = c.eddResult?.result.outcome;

  const approve = (): Availability => {
    if (!reviewing) return no("Start the review first.");
    if (engineReject) return no(`Engine hard rule: ${c.risk?.reason ?? "reject"}. The case can only be rejected.`);
    if (open) return no(`${open} open screening hit${open === 1 ? "" : "s"} to triage first.`);
    if (confirmedSanctions) return no("Confirmed sanctions match.");
    if (c.risk?.edd_required && eddOutcome !== "new_threshold")
      return no(eddOutcome ? "EDD outcome does not allow approval: funds must be returned." : `Band ${c.risk.band === "auto_high" ? "Auto-High" : "High"}: EDD must be completed before approval.`);
    if (!c.risk?.edd_required && eddOutcome && eddOutcome !== "new_threshold") return no("EDD outcome does not allow approval: funds must be returned.");
    return yes;
  };

  return {
    start_review: c.status === "submitted" ? yes : no(`Case is ${c.status}.`),
    approve: approve(),
    request_edd: !reviewing ? no("Start the review first.") : engineReject ? no("Engine hard rule: the case can only be rejected.") : yes,
    reject: reviewing ? yes : no("Start the review first."),
    recalculate_edd: c.status === "edd_submitted" ? yes : no("Available once the applicant has sent the EDD documents."),
  };
}
