// npm run demo:reset  -> wipes the local demo DB and uploads, seeds the personas. Offline:
// Claude pre-review and memos are replayed only where recordings exist (DEMO_MODE=replay).
import { it } from "vitest";
import { resetDemo } from "@/demo/seed";
import { portalDeps } from "@/portal/deps";

it("resets the demo", { timeout: 120_000 }, async () => {
  const r = await resetDemo(portalDeps(), { claude: "auto", actor: "cli" });
  console.log(r.cases.map((c) => `  ${c.personaId.padEnd(11)} ${c.band}`).join("\n"));
  console.log(`  ${r.claude.note}`);
});
