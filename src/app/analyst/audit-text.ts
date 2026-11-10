// Plain-English audit lines for the console (boards C02/C03 "Audit trail"). Presentation only:
// the stored audit_log rows are unchanged.

type Entry = { action: string; actor: string; payload: unknown };
type P = Record<string, unknown>;

const BAND: Record<string, string> = { low: "Low", medium: "Medium", high: "High", auto_high: "Auto-High", prohibited: "Prohibited" };
const usd = (n: unknown) => (typeof n === "number" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n) : "-");
const KIND: Record<string, string> = { poi_front: "identity document (front)", poi_back: "identity document (back)", selfie: "selfie", por: "proof of residence", sof: "source-of-funds document", edd_kyc: "ID-holding photo", company_doc: "company document", person_poi: "person's ID", person_por: "person's proof of residence" };

export function actorLabel(actor: string, analysts: { id: string; name: string }[], action: string): string {
  if (actor.startsWith("applicant:")) return "Applicant";
  if (actor.startsWith("analyst:")) return analysts.find((a) => `analyst:${a.id}` === actor)?.name ?? actor.slice("analyst:".length);
  if (actor === "engine") return "Rules engine";
  if (actor === "claude") return "Claude";
  if (action.startsWith("screening.completed")) return "Screening";
  if (action.startsWith("face_match")) return "Face match";
  return "System";
}

export function describe(e: Entry): string {
  const p = (e.payload ?? {}) as P;
  const risk = (p.risk ?? {}) as P;
  switch (e.action) {
    case "account.created": return `Account created (${p.persona ?? "individual"}).`;
    case "otp.issued": return "Verification code sent (the code itself is never logged).";
    case "otp.failed": return `Wrong verification code entered (attempt ${p.attempts}).`;
    case "email.verified": return "Email address verified.";
    case "session.started": return "Signed in again with a new code.";
    case "session.ended": return "Signed out.";
    case "step.completed": return `Completed step: ${p.step}${p.source === "wallet" ? " (shared from an ID wallet)" : p.selfie ? ` (selfie ${p.selfie})` : ""}.`;
    case "agent.conversation_started": return `Applicant started a chat with the AI assistant in the portal (prompt ${p.promptVersion}).`;
    case "agent.cap_reached": return `AI assistant stopped at its ${p.cap === "tool_calls" ? "tool-call" : p.cap === "cost" ? "spending" : "conversation length"} limit and offered the form.`;
    case "agent.output_blocked": return `AI assistant reply withheld by the output guard (${p.termCount} blocked term${p.termCount === 1 ? "" : "s"}); the applicant saw the fixed deflection line.`;
    case "agent.tool_called": return `AI ${p.channel === "mcp" ? `client${p.clientName ? ` "${p.clientName}"` : ""} (MCP)` : "assistant (portal)"} used ${p.tool}${p.outcome === "ok" ? "" : ` (${p.outcome})`}.`;
    case "agent.tool_denied": return `AI ${p.channel === "mcp" ? "client (MCP)" : "assistant (portal)"} was refused ${p.tool}: ${String(p.reason).replaceAll("_", " ")}.`;
    case "agent.secure_step_requested": return `AI ${p.channel === "mcp" ? "client (MCP)" : "assistant (portal)"} sent the applicant a link to the ${p.step} page.`;
    case "answers.confirmed": return `Applicant checked ${(p.fields as string[] | undefined)?.length ?? 0} answers drafted by ${((p.sources as string[] | undefined) ?? []).map((s) => (s === "mcp" ? "an AI client over MCP" : "the AI assistant in the portal")).join(" and ") || "an AI assistant"} on the review page: ${p.unchanged} kept, ${p.edited} edited.`;
    case "wallet.session_started": return "ID wallet request opened (single-use nonce, expires soon).";
    case "wallet.verified": return `ID wallet presentation verified: issuer ${p.issuer}, ${(p.checks as string[] | undefined)?.length ?? 0} checks passed${(p.ignoredClaims as string[] | undefined)?.length ? `; ignored unrequested claims: ${(p.ignoredClaims as string[]).join(", ")}` : ""}.`;
    case "wallet.rejected": return `ID wallet presentation rejected: ${p.code}${p.detail ? ` (${p.detail})` : ""}. The applicant saw a neutral message.`;
    case "step.saved": return `Saved step: ${p.step}${p.selfie === "retry" ? ", selfie to retake" : ""}.`;
    case "document.uploaded": return `Uploaded ${KIND[String(p.kind)] ?? p.kind}${p.docType ? ` (${p.docType})` : ""}.`;
    case "face_match.result": return `Selfie checked by the face-match provider: liveness ${p.liveness}, match ${p.match}.`;
    case "person.added": return `Person added (${(p.roles as string[] | undefined)?.join(", ")}).`;
    case "person.updated": return "Person details updated.";
    case "person.removed": return "Person removed.";
    case "case.submitted": return "Application submitted for review.";
    case "engine.scored":
      if (risk.decision === "reject" && !risk.band) return `Hard rule before scoring: ${risk.reason}. Routed to reject.`;
      return `Scored${risk.total !== undefined ? ` ${risk.total}` : ""}, band ${BAND[String(risk.band)] ?? risk.band}${risk.forced_by ? ` (raised by ${risk.forced_by})` : ""}.${(p.threshold as P | null)?.threshold !== undefined ? ` Initial threshold ${usd((p.threshold as P).threshold)}.` : ""}${risk.decision === "reject" ? " Routed to reject." : risk.edd_required ? " EDD required." : ""}`;
    case "engine.rescored": return `Re-scored after a confirmed ${p.cause === "pep_match_confirmed" ? "PEP match" : "change"}: band ${BAND[String(risk.band)] ?? risk.band}.`;
    case "screening.completed": return `Sanctions and PEP screening completed (${p.provider}). ${p.hits} hit${p.hits === 1 ? "" : "s"}.`;
    case "screening.triaged": return `Screening hit ${p.entryId} marked ${String(p.to).replace("_", " ")}: ${p.reason}`;
    case "case.review_started": return "Review started.";
    case "case.decided": return `Decision: ${p.decision === "edd" ? "request EDD" : p.decision}. Reason: ${p.reason}`;
    case "edd.requested": return "Enhanced due diligence requested: proof of source of funds.";
    case "edd.submitted": return `Applicant sent ${p.sofDocuments} source-of-funds document(s).`;
    case "engine.edd_recalculated": {
      const r = (p.result ?? {}) as P;
      return r.outcome === "new_threshold" ? `EDD recalculated: new threshold ${usd(r.new_threshold)}, headroom ${usd(r.headroom)}.` : `EDD recalculated: ${String(r.outcome).replaceAll("_", " ")}.`;
    }
    case "funds.return_instruction": return `Instruction recorded: return ${usd(p.amount)}, report to AML and Compliance.`;
    case "prereview.requested": return "Claude pre-review requested.";
    case "prereview.completed": return `Advisory pre-review completed: ${p.pass ?? 0} pass, ${p.flag ?? 0} flag, ${p.fail ?? 0} fail${p.gaps !== undefined ? `, ${p.gaps} KYB gaps` : ""}.`;
    case "prereview.failed": return `Pre-review could not run: ${p.error}`;
    case "claude.call": return `Claude ${p.kind} call (${p.source}, attempt ${p.attempt}): ${p.outcome}. Model ${p.model ?? "-"}, prompt ${p.promptVersion}, input ${String(p.inputHash ?? "").slice(0, 10)}…`;
    case "memo.drafted": return `Case memo drafted (advisory: ${String(p.recommended_action).replaceAll("_", " ")}).`;
    case "memo.failed": return `Case memo not drafted: ${p.error}`;
    case "mode.changed": return `Mode changed from ${String(p.from).toUpperCase()} to ${String(p.to).toUpperCase()}.`;
    case "demo.reset": return `Demo reset: ${p.cases} synthetic cases seeded.`;
    default: return e.action;
  }
}

export const when = (ts: string) =>
  new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
