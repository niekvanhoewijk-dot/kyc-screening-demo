import { and, eq, isNull } from "drizzle-orm";
import { casePersons, cases, documentReadings, documents } from "@/db/schema";
import type { KybClassification } from "@/documents/kyb-schemas";
import type { PortalDeps } from "@/portal/deps";
import { gapList, type Gap, type GapInput } from "./gaps";

/** Builds the gap-list input from the DB. `withClaude` adds MVP 2 classifications. */
export function loadGapInput(deps: PortalDeps, caseId: string, withClaude: boolean): GapInput | null {
  const c = deps.db.select().from(cases).where(eq(cases.id, caseId)).get();
  if (!c || c.persona !== "company" || !c.company) return null;
  const company = c.company as { legalName: string; registrationNumber: string };
  const docs = deps.db.select().from(documents).where(and(eq(documents.caseId, caseId), isNull(documents.supersededAt))).all();
  const readings = withClaude ? deps.db.select().from(documentReadings).where(and(eq(documentReadings.caseId, caseId), eq(documentReadings.kind, "kyb"))).all() : [];
  const classificationOf = (docId: string) => {
    const r = readings.filter((x) => x.documentId === docId && x.status === "ok").at(-1);
    return (r?.extraction as KybClassification | undefined) ?? null;
  };
  const persons = deps.db.select().from(casePersons).where(eq(casePersons.caseId, caseId)).all();
  return {
    company,
    persons: persons.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      roles: p.roles as string[],
      sharePercent: p.sharePercent === null ? null : Number(p.sharePercent),
      isApplicant: p.isApplicant,
      hasPoi: docs.some((d) => d.personId === p.id && d.kind === "person_poi"),
      hasPor: docs.some((d) => d.personId === p.id && d.kind === "person_por"),
    })),
    applicantDocs: { poi: docs.some((d) => d.kind === "poi_front" && !d.personId), por: docs.some((d) => d.kind === "por" && !d.personId) },
    docs: docs.filter((d) => d.kind === "company_doc").map((d) => ({ id: d.id, name: d.originalName, tag: d.docType, classification: classificationOf(d.id) })),
  };
}

export function caseGaps(deps: PortalDeps, caseId: string, withClaude: boolean): Gap[] | null {
  const input = loadGapInput(deps, caseId, withClaude);
  return input ? gapList(input, deps.kyb) : null;
}
