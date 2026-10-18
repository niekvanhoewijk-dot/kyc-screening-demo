// npm run demo:record -> seeds the personas with LIVE Claude calls (needs ANTHROPIC_API_KEY) and
// records every document read and memo into fixtures/claude-cache, so `demo:reset` and the app
// replay them offline afterwards. Costs a few dollars at most; see npm run eval for per-case cost.
import { it } from "vitest";
import { documentReaderFromEnv } from "@/documents/factory";
import { resetDemo } from "@/demo/seed";
import { portalDeps } from "@/portal/deps";

it("records the demo personas", { timeout: 20 * 60_000 }, async () => {
  const deps = { ...portalDeps(), documentReader: (log: Parameters<ReturnType<typeof portalDeps>["documentReader"]>[0]) => documentReaderFromEnv(log, "live") };
  const r = await resetDemo(deps, { claude: "run", actor: "cli" });
  console.log(r.cases.map((c) => `  ${c.personaId.padEnd(11)} ${c.band}`).join("\n"));
  console.log(`  ${r.claude.note} (${r.claude.memos} memos)`);
});
