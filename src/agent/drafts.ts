import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { intakeDrafts } from "@/db/schema";
import { newId } from "@/lib/ids";

// Draft answers from an agent and the provenance of confirmed answers (docs/spec/10 section 6).
// A draft never reaches the engine: the person confirms it on the review page, which saves the answers as the form does.

export type DraftStep = "questionnaire";
export type DraftSource = "interviewer" | "mcp";
export type AnswerSource = "form" | DraftSource;
export type Draft = { value: unknown; source: DraftSource; clientId: string | null; clientName: string | null; savedAt: string };
export type ProvenanceEntry = { source: AnswerSource; clientId?: string; clientName?: string; confirmedAt?: string };
export type Provenance = Record<string, ProvenanceEntry>;

export function upsertDraft(
  deps: { db: Db; now: () => Date },
  d: { caseId: string; step: DraftStep; field: string; value: unknown; source: DraftSource; client?: { id: string; name: string } },
) {
  const row = {
    value: d.value ?? null,
    source: d.source,
    clientId: d.client?.id ?? null,
    clientName: d.client?.name ?? null,
    savedAt: deps.now().toISOString(),
  };
  deps.db
    .insert(intakeDrafts)
    .values({ id: newId(), caseId: d.caseId, step: d.step, field: d.field, ...row })
    .onConflictDoUpdate({ target: [intakeDrafts.caseId, intakeDrafts.step, intakeDrafts.field], set: row })
    .run();
}

export function draftsFor(deps: { db: Db }, caseId: string, step: DraftStep): Record<string, Draft> {
  const rows = deps.db.select().from(intakeDrafts).where(and(eq(intakeDrafts.caseId, caseId), eq(intakeDrafts.step, step))).all();
  return Object.fromEntries(rows.map((r) => [r.field, { value: r.value, source: r.source, clientId: r.clientId, clientName: r.clientName, savedAt: r.savedAt }]));
}

export function clearDrafts(deps: { db: Db }, caseId: string, step: DraftStep) {
  deps.db.delete(intakeDrafts).where(and(eq(intakeDrafts.caseId, caseId), eq(intakeDrafts.step, step))).run();
}

/** "Answered as none" (null) and "not given" (undefined) are the same answer. */
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Who answered each confirmed field (spec 10 section 6 step 3): a field the person left as the draft keeps the draft's
 * source and is marked confirmed; a field they edited, or one without a draft, is the form's. Null when nothing was drafted.
 */
export function mergeProvenance(drafts: Record<string, Draft>, answers: Record<string, unknown>, fieldIds: string[], confirmedAt: string) {
  if (Object.keys(drafts).length === 0) return null;
  const provenance: Provenance = {};
  let unchanged = 0;
  let edited = 0;
  for (const id of fieldIds) {
    const d = drafts[id];
    if (d && same(d.value, answers[id])) {
      unchanged++;
      provenance[id] = { source: d.source, ...(d.clientId ? { clientId: d.clientId } : {}), ...(d.clientName ? { clientName: d.clientName } : {}), confirmedAt };
    } else {
      if (d) edited++;
      provenance[id] = { source: "form" };
    }
  }
  const sources = [...new Set(Object.values(drafts).map((d) => d.source))].sort();
  return { provenance, unchanged, edited, sources };
}
