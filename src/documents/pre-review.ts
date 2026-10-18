import { and, eq, isNull } from "drizzle-orm";
import { applicants, cases, documentReadings, documents } from "@/db/schema";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import type { PortalDeps } from "@/portal/deps";
import type { IdentityData, QuestionnaireData, ResidenceData } from "@/portal/cases";
import { runChecks, type Check, type CheckRules } from "./checks";
import type { CallLog, DocumentReader, ReadOutcome } from "./reader";

export type PreReviewDeps = PortalDeps & {
  documentReader: (log: (entry: CallLog) => void) => DocumentReader;
  checkRules: CheckRules;
};

export type PreReview = {
  ranAt: string;
  checks: Check[];
  porValidUntil: string | null;
  summary: { fail: number; flag: number; pass: number; reasonCodes: string[] };
};

const missing = (error: string): ReadOutcome<never> => ({ status: "failed", error, calls: [] });

/**
 * MVP 2 pre-review: Claude reads POI and POR, code runs the cross-checks. Never changes the case
 * status, score or decision; the result is shown to the analyst beside the engine output.
 */
export async function runPreReview(deps: PreReviewDeps, caseId: string): Promise<PreReview> {
  const { db } = deps;
  const c = db.select().from(cases).where(eq(cases.id, caseId)).get();
  if (!c) throw new Error(`case ${caseId} not found`);
  const applicant = db.select().from(applicants).where(eq(applicants.id, c.applicantId)).get()!;
  const identity = c.identity as IdentityData;
  const residence = c.residence as ResidenceData;
  const questionnaire = c.questionnaire as QuestionnaireData;

  const reader = deps.documentReader((call) =>
    // spec: log model, prompt version, input hash and output of every Claude call
    audit(db, deps.now(), "claude", "claude.call", `case:${caseId}`, call),
  );

  const current = (kind: "poi_front" | "por") =>
    db.select().from(documents).where(and(eq(documents.caseId, caseId), eq(documents.kind, kind), isNull(documents.supersededAt))).get();

  const read = async <K extends "poi" | "por">(kind: K) => {
    const doc = current(kind === "poi" ? "poi_front" : "por");
    if (!doc) return { doc, outcome: missing("Document not uploaded.") };
    const input = { bytes: await deps.files.read(doc.storedPath), mime: doc.mime, sha256: doc.sha256 };
    const outcome = kind === "poi" ? await reader.readPoi(input) : await reader.readPor(input);
    const last = outcome.calls.at(-1);
    db.insert(documentReadings)
      .values({
        id: newId(),
        caseId,
        documentId: doc.id,
        kind,
        status: outcome.status,
        extraction: outcome.status === "ok" ? outcome.extraction : null,
        error: outcome.status === "failed" ? outcome.error : null,
        reader: last?.reader ?? "unknown",
        model: last?.model ?? null,
        promptVersion: last?.promptVersion ?? "",
        inputHash: last?.inputHash ?? "",
        source: last?.source ?? "live",
        createdAt: deps.now().toISOString(),
      })
      .run();
    return { doc, outcome };
  };

  const [poi, por] = [await read("poi"), await read("por")];
  const { checks, porValidUntil } = runChecks(
    {
      today: deps.now().toISOString().slice(0, "yyyy-mm-dd".length),
      applicant,
      declared: { dateOfBirth: questionnaire.dateOfBirth, address: residence, selfie: identity.selfie },
      poi: poi.outcome as Parameters<typeof runChecks>[0]["poi"],
      por: por.outcome as Parameters<typeof runChecks>[0]["por"],
    },
    deps.checkRules,
  );
  const count = (s: Check["status"]) => checks.filter((x) => x.status === s).length;
  const result: PreReview = {
    ranAt: deps.now().toISOString(),
    checks,
    porValidUntil,
    summary: { fail: count("fail"), flag: count("flag"), pass: count("pass"), reasonCodes: [...new Set(checks.flatMap((x) => x.reason_codes))] },
  };
  db.update(cases).set({ preReview: result }).where(eq(cases.id, caseId)).run();
  audit(db, deps.now(), "claude", "prereview.completed", `case:${caseId}`, result.summary);
  return result;
}
