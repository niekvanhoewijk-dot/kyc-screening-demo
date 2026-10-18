// Records real Claude responses for the labelled KYB set (live API calls). Part of npm run docs:record.
import { it } from "vitest";
import { documentReaderFromEnv } from "@/documents/factory";
import { loadKybConfig } from "@/engine";
import { evaluateKybDocument, loadKybSet } from "@/eval/kyb-set";

it("records the KYB set", { timeout: 15 * 60_000 }, async () => {
  const set = loadKybSet();
  const reader = documentReaderFromEnv((c) => console.log(`  ${c.kind} attempt ${c.attempt}: ${c.outcome} model=${c.model}`), "live");
  for (const doc of set.documents) {
    const r = await evaluateKybDocument(reader, set, doc, loadKybConfig());
    console.log(`${r.type === r.expectedType && JSON.stringify(r.expected) === JSON.stringify(r.fired) ? "MATCH " : "DIFFER"}  ${doc.id.padEnd(34)} type ${r.type} (expected ${r.expectedType})  codes [${r.fired.join(", ")}] expected [${r.expected.join(", ")}]`);
  }
});
