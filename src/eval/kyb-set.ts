import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { REASON_CODES } from "@/documents/reason-codes";
import type { DocumentReader, ReadOutcome } from "@/documents/reader";
import type { KybClassification } from "@/documents/kyb-schemas";
import type { KybConfig } from "@/engine";
import { documentGaps } from "@/kyb/gaps";
import { sha256 } from "@/lib/ids";

export const KYB_FIXTURE_DIR = path.resolve(/* turbopackIgnore: true */ process.cwd(), "fixtures/documents/kyb");

const schema = z.object({
  description: z.string(),
  context: z.object({
    company: z.object({ legalName: z.string(), registrationNumber: z.string() }),
    persons: z.array(z.object({ id: z.string(), fullName: z.string(), roles: z.array(z.string()), sharePercent: z.number().nullable() })),
  }),
  documents: z.array(z.object({ id: z.string(), file: z.string(), expected_type: z.string(), expected_codes: z.array(z.enum(REASON_CODES)), note: z.string() })),
});
export type KybSet = z.infer<typeof schema>;

export const loadKybSet = (): KybSet => schema.parse(JSON.parse(fs.readFileSync(path.join(KYB_FIXTURE_DIR, "labels.json"), "utf8")));

export type KybDocResult = { id: string; expectedType: string; type: string | null; expected: string[]; fired: string[]; status: "ok" | "failed"; outcome: ReadOutcome<KybClassification> };

/** Classify one labelled company document and run the document-level KYB checks against the context. */
export async function evaluateKybDocument(reader: DocumentReader, set: KybSet, doc: KybSet["documents"][number], kyb: KybConfig): Promise<KybDocResult> {
  const bytes = fs.readFileSync(path.join(KYB_FIXTURE_DIR, doc.file));
  const outcome = await reader.readKyb({ bytes, mime: "image/png", sha256: sha256(bytes) });
  const x = outcome.status === "ok" ? outcome.extraction : null;
  const persons = set.context.persons.map((p) => ({ ...p, isApplicant: false, hasPoi: true, hasPor: true }));
  const gaps = x ? documentGaps({ id: doc.id, name: doc.file, tag: null, classification: x }, { company: set.context.company, persons }, kyb) : [];
  return {
    id: doc.id,
    expectedType: doc.expected_type,
    type: x?.document_type ?? null,
    expected: [...doc.expected_codes].sort(),
    fired: [...new Set(gaps.flatMap((g) => (g.code ? [g.code] : [])))].sort(),
    status: outcome.status,
    outcome,
  };
}
