import fs from "node:fs";
import path from "node:path";
import { sha256 } from "@/lib/ids";
import { runChecks, type CheckRules } from "./checks";
import { FIXTURE_DIR, MIME_BY_EXT, type LabelledSet } from "./labelled-set";
import type { DocumentReader, ReadOutcome } from "./reader";
import type { PoiExtraction, PorExtraction } from "./schemas";

export type DocResult = { id: string; expected: string[]; fired: string[]; status: "ok" | "failed"; error?: string };

/**
 * Runs one labelled document through reader + rule checks. The counterpart document is a clean,
 * hand-built extraction so only the document under test can raise codes.
 */
export async function evaluateDocument(
  reader: DocumentReader,
  set: LabelledSet,
  doc: LabelledSet["documents"][number],
  clean: { poi: PoiExtraction; por: PorExtraction },
  rules: CheckRules,
): Promise<DocResult> {
  const bytes = fs.readFileSync(path.join(FIXTURE_DIR, doc.file));
  const input = { bytes, mime: MIME_BY_EXT[path.extname(doc.file)] ?? "application/octet-stream", sha256: sha256(bytes) };
  const read: ReadOutcome<PoiExtraction | PorExtraction> = doc.kind === "poi" ? await reader.readPoi(input) : await reader.readPor(input);
  const { checks } = runChecks(
    {
      today: set.context.as_of,
      applicant: set.context.applicant,
      declared: set.context.declared,
      poi: doc.kind === "poi" ? (read as ReadOutcome<PoiExtraction>) : { status: "ok", extraction: clean.poi, calls: [] },
      por: doc.kind === "por" ? (read as ReadOutcome<PorExtraction>) : { status: "ok", extraction: clean.por, calls: [] },
    },
    rules,
  );
  const fired = [...new Set(checks.flatMap((c) => c.reason_codes))].sort();
  return { id: doc.id, expected: [...doc.expected_codes].sort(), fired, status: read.status, error: read.status === "failed" ? read.error : undefined };
}
