import type { PortalDeps } from "@/portal/deps";
import { questionnaireFields } from "@/portal/fields";

// The interviewer's output guard (docs/spec/10 section 7): a second layer behind the tools, which give the model
// no score, band, reason or screening data to repeat. A reply with a forbidden term is replaced by the deflection.

const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Questionnaire wording the portal already shows applicants (exempt_label_sources), longest first. */
export function exemptTexts(deps: Pick<PortalDeps, "engine" | "portal" | "agent">): string[] {
  if (!deps.agent.guard.exempt_label_sources.includes("questionnaire")) return [];
  const out = new Set<string>();
  for (const f of questionnaireFields(deps.engine, deps.portal)) {
    out.add(f.label);
    if (f.hint) out.add(f.hint);
    for (const o of f.options ?? []) out.add(o.label);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** How many forbidden terms the text holds, matched case-insensitively at the start of a word. */
export function forbiddenCount(text: string, deps: Pick<PortalDeps, "engine" | "portal" | "agent">): number {
  let rest = text;
  for (const e of exemptTexts(deps)) rest = rest.split(e).join(" ");
  const pattern = new RegExp(`\\b(${deps.agent.guard.forbidden_terms.map(escape).join("|")})`, "gi");
  return rest.match(pattern)?.length ?? 0;
}

export function checkReply(text: string, deps: Pick<PortalDeps, "engine" | "portal" | "agent">): { ok: true } | { ok: false; termCount: number } {
  const termCount = forbiddenCount(text, deps);
  return termCount === 0 ? { ok: true } : { ok: false, termCount };
}
