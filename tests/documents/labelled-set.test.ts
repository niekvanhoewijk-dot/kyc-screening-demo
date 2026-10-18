import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ClaudeDocumentReader } from "@/documents/claude-reader";
import { loadDocumentReadingConfig } from "@/documents/config";
import { evaluateDocument } from "@/documents/evaluate";
import { checkRulesFromConfig } from "@/documents/factory";
import { FIXTURE_DIR, loadLabelledSet } from "@/documents/labelled-set";
import { ReplayCache } from "@/documents/replay-cache";
import { sha256 } from "@/lib/ids";
import { env } from "@/lib/env";
import { poi, por } from "./extractions";

const set = loadLabelledSet();
const reader = new ClaudeDocumentReader({ model: env.CLAUDE_MODEL, mode: "replay", config: loadDocumentReadingConfig() });
const cache = new ReplayCache();
const recorded = (doc: (typeof set.documents)[number]) => {
  const bytes = fs.readFileSync(path.join(FIXTURE_DIR, doc.file));
  return cache.get(reader.cacheKey(doc.kind, { bytes, mime: "", sha256: sha256(bytes) })) !== null;
};

describe("labelled synthetic set", () => {
  it("covers the Phase 3 acceptance codes", () => {
    const labelled = new Set(set.documents.flatMap((d) => d.expected_codes));
    for (const code of ["POI_EXPIRED", "POI_CORNERS_NOT_VISIBLE", "POR_OLDER_THAN_3_MONTHS", "POR_PO_BOX", "POR_MOBILE_BILL"])
      expect(labelled).toContain(code);
    for (const d of set.documents) expect(fs.existsSync(path.join(FIXTURE_DIR, d.file))).toBe(true);
  });

  // Replays recorded Claude responses (DEMO_MODE=replay path). Documents without a recording are
  // skipped, not passed: record them with `npm run docs:record`.
  for (const doc of set.documents) {
    it.skipIf(!recorded(doc))(`${doc.id}: fires exactly [${doc.expected_codes.join(", ")}]`, async () => {
      const r = await evaluateDocument(reader, set, doc, { poi: poi(), por: por() }, checkRulesFromConfig());
      expect(r.status).toBe("ok");
      expect(r.fired).toEqual([...doc.expected_codes].sort());
    });
  }
});
