// Records real Claude responses for the labelled set into fixtures/claude-cache (live API calls).
// Run: npm run docs:record   (needs ANTHROPIC_API_KEY in .env.local, or another SDK credential)
// Then `npm run test` replays them offline and asserts the expected reason codes.
import fs from "node:fs";
import { it } from "vitest";
import { evaluateDocument } from "@/documents/evaluate";
import { checkRulesFromConfig, documentReaderFromEnv } from "@/documents/factory";
import { loadLabelledSet } from "@/documents/labelled-set";
import { poi, por } from "../../tests/documents/extractions";

it("records the labelled set", { timeout: 15 * 60_000 }, async () => {
  const set = loadLabelledSet();
  const reader = documentReaderFromEnv((c) => console.log(`  ${c.kind} attempt ${c.attempt}: ${c.outcome}${c.detail ? ` (${c.detail})` : ""} model=${c.model}`), "live");
  const rows = [];
  for (const doc of set.documents) {
    console.log(`reading ${doc.id}`);
    const r = await evaluateDocument(reader, set, doc, { poi: poi(), por: por() }, checkRulesFromConfig());
    const ok = r.status === "ok" && JSON.stringify(r.expected) === JSON.stringify(r.fired);
    rows.push(`${ok ? "MATCH " : "DIFFER"}  ${doc.id.padEnd(26)} expected [${r.expected.join(", ")}]  fired [${r.fired.join(", ")}]${r.error ? `  ${r.error}` : ""}`);
  }
  const report = rows.join("\n");
  console.log(`\n${report}`);
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/docs-record-report.txt", report + "\n");
});
