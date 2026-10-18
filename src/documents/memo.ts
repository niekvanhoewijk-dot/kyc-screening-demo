import { eq } from "drizzle-orm";
import { casePersons, cases, screeningHits } from "@/db/schema";
import type { CompanyScore } from "@/engine";
import { audit } from "@/lib/audit";
import { caseGaps } from "@/kyb/load";
import { MEMO_DISCLAIMER, type MemoDraft } from "./kyb-schemas";
import type { PreReview, PreReviewDeps } from "./pre-review";

export type CaseMemo = MemoDraft & {
  /** Copied from the engine output by code (spec 06): never computed by the model. */
  score_breakdown_restatement: string[];
  checks: { name: string; status: string; reason_codes: string[] }[];
  disclaimer: typeof MEMO_DISCLAIMER;
  model: string | null;
  promptVersion: string;
  draftedAt: string;
  draftedFor: string;
};

type IndividualRisk = { total?: number; band?: string; score_band?: string; forced_by?: string; edd_required?: boolean; decision?: string; reason?: string; breakdown?: { factor: string; tier: string; points: number }[] };

/** Deterministic restatement of the engine result for the memo header. */
export function restateScore(persona: string, risk: unknown): string[] {
  if (!risk) return ["Not scored."];
  if (persona === "company") {
    const r = risk as CompanyScore;
    return [
      `Company band ${r.band} (demo default, O-8): ${r.driver.kind === "company_country" ? "set by the country of incorporation" : `set by ${r.driver.name}`}.`,
      `Country of incorporation ${r.companyCountry.code}: tier ${r.companyCountry.tier} (${r.companyCountry.source}, as of ${r.companyCountry.as_of}).`,
      ...r.persons.map((p) => `${p.name}: ${p.band}${p.raisedBy ? " (PEP)" : ""}, resident ${p.country.code}.`),
      ...(r.decision ? [`Engine routing: ${r.decision} (${r.reason}).`] : r.edd_required ? ["Engine routing: EDD required."] : []),
    ];
  }
  const r = risk as IndividualRisk;
  if (!r.breakdown) return [`Engine routing: ${r.decision} (${r.reason}) before scoring.`];
  return [
    ...r.breakdown.map((b) => `${b.factor}: ${b.tier} (${b.points})`),
    `Total ${r.total}, band ${r.band}${r.forced_by ? ` (raised from ${r.score_band} by ${r.forced_by})` : ""}.`,
    ...(r.decision ? [`Engine routing: ${r.decision} (${r.reason}).`] : r.edd_required ? ["Engine routing: EDD required."] : []),
  ];
}

/** Facts for the memo: engine output, screening, checks and gaps. No contact details are sent. */
export function memoFacts(deps: PreReviewDeps, caseId: string) {
  const c = deps.db.select().from(cases).where(eq(cases.id, caseId)).get()!;
  const persons = deps.db.select().from(casePersons).where(eq(casePersons.caseId, caseId)).all();
  const subject = (s: string | null) => (s === null ? "applicant" : s === "company" ? "company" : (persons.find((p) => p.id === s)?.fullName ?? "person"));
  const hits = deps.db.select().from(screeningHits).where(eq(screeningHits.caseId, caseId)).all();
  const pre = c.preReview as PreReview | null;
  return {
    persona: c.persona,
    status: c.status,
    engine: c.riskResult,
    threshold: (c.thresholdResult as { threshold?: number } | null)?.threshold ?? null,
    screening: hits.map((h) => ({ subject: subject(h.subject), list_entry: h.entryName, category: h.category, strength: h.strength, match: h.match, triage: h.status })),
    document_checks: pre?.checks.filter((x) => x.status !== "pass").map((x) => ({ name: x.name, status: x.status, reason_codes: x.reason_codes, detail: x.detail })) ?? "pre-review not run",
    kyb_gaps: c.persona === "company" ? (caseGaps(deps, caseId, true) ?? []).map((g) => ({ code: g.code, detail: g.detail })) : undefined,
    persons: c.persona === "company" ? persons.map((p) => ({ name: p.fullName, roles: p.roles, share_percent: p.sharePercent, pep_declared: p.pep })) : undefined,
    edd: { requested: c.eddRequest ?? null, submitted: c.eddSubmission ?? null, result: c.eddResult ?? null },
  };
}

/** spec 06 CaseMemo, MVP 2. Advisory: shown under the engine's routing, never in place of it. */
export async function draftCaseMemo(deps: PreReviewDeps, caseId: string, analystId: string): Promise<CaseMemo | { error: string }> {
  const c = deps.db.select().from(cases).where(eq(cases.id, caseId)).get();
  if (!c) return { error: "Case not found." };
  const writer = deps.documentReader((call) => audit(deps.db, deps.now(), "claude", "claude.call", `case:${caseId}`, call));
  const out = await writer.draftMemo(memoFacts(deps, caseId));
  if (out.status === "failed") {
    audit(deps.db, deps.now(), "claude", "memo.failed", `case:${caseId}`, { error: out.error });
    return { error: out.error };
  }
  const last = out.calls.at(-1);
  const pre = c.preReview as PreReview | null;
  const memo: CaseMemo = {
    ...out.extraction,
    score_breakdown_restatement: restateScore(c.persona, c.riskResult),
    checks: pre?.checks.map((x) => ({ name: x.name, status: x.status, reason_codes: x.reason_codes })) ?? [],
    disclaimer: MEMO_DISCLAIMER,
    model: last?.model ?? null,
    promptVersion: last?.promptVersion ?? "",
    draftedAt: deps.now().toISOString(),
    draftedFor: `analyst:${analystId}`,
  };
  deps.db.update(cases).set({ memo }).where(eq(cases.id, caseId)).run();
  audit(deps.db, deps.now(), "claude", "memo.drafted", `case:${caseId}`, { recommended_action: memo.recommended_action, requestedBy: `analyst:${analystId}` });
  return memo;
}
