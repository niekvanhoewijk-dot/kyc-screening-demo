import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { applicants, auditLog, cases, documentReadings, documents, faceMatches, screeningHits } from "@/db/schema";
import type { PortalDeps } from "@/portal/deps";
import { PortalError } from "@/portal/errors";
import { guardInput } from "./actions";
import { availableActions } from "./guards";

/** Everything the case view needs, in one read. */
export function loadCaseView(deps: PortalDeps, caseId: string) {
  const c = deps.db.select().from(cases).where(eq(cases.id, caseId)).get();
  if (!c) throw new PortalError("NOT_FOUND", "Case not found.");
  const applicant = deps.db.select().from(applicants).where(eq(applicants.id, c.applicantId)).get()!;
  const docs = deps.db.select().from(documents).where(and(eq(documents.caseId, caseId), isNull(documents.supersededAt))).orderBy(asc(documents.uploadedAt)).all();
  const readings = deps.db.select().from(documentReadings).where(eq(documentReadings.caseId, caseId)).orderBy(asc(documentReadings.createdAt)).all();
  const hits = deps.db.select().from(screeningHits).where(eq(screeningHits.caseId, caseId)).orderBy(asc(screeningHits.createdAt)).all();
  const faces = deps.db.select().from(faceMatches).where(eq(faceMatches.caseId, caseId)).orderBy(asc(faceMatches.createdAt)).all();
  const trail = deps.db
    .select()
    .from(auditLog)
    .where(or(eq(auditLog.entity, `case:${caseId}`), inArray(auditLog.entity, [`applicant:${applicant.id}`])))
    .orderBy(asc(auditLog.id))
    .all();
  const latestReading = (kind: "poi" | "por") => readings.filter((r) => r.kind === kind).at(-1) ?? null;
  return {
    c,
    applicant,
    docs,
    readings: { poi: latestReading("poi"), por: latestReading("por") },
    hits,
    faces,
    trail,
    actions: availableActions(guardInput(c, hits)),
  };
}

export type CaseView = ReturnType<typeof loadCaseView>;
