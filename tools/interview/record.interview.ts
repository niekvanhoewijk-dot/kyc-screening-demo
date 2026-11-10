// npm run interview:record -> plays every scripted applicant (fixtures/interviews) LIVE against the model and stores
// the real responses in fixtures/claude-cache (kind "interview"), so the interviewer replays offline. Costs money:
// it needs ANTHROPIC_API_KEY in .env.local. INTERVIEW=<id> records one script only. Never part of `npm run test`.
import fs from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { sdkCreateCall } from "@/agent/interviewer";
import { ReplayCache } from "@/documents/replay-cache";
import { env } from "@/lib/env";
import { loadScripts, runScript } from "../../tests/agent/scripted-harness";

it("records the scripted interviews (live API)", { timeout: 3_600_000 }, async () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Put ANTHROPIC_API_KEY in .env.local first (see .env.example).");
  const only = process.env.INTERVIEW;
  const scripts = loadScripts().filter((s) => !only || s.id === only);
  const create = sdkCreateCall();
  const rows: string[] = [];
  let total = 0;
  for (const script of scripts) {
    const run = await runScript(script, { mode: "live", model: env.CLAUDE_MODEL, create, cache: new ReplayCache() });
    total += run.costUsd;
    const expected = Object.keys(script.expect.answers);
    const matched = expected.filter((k) => JSON.stringify(run.drafts[k] ?? null) === JSON.stringify(script.expect.answers[k])).length;
    const notOk = run.turns.map((t) => t.result.outcome).filter((o) => o !== "ok");
    rows.push(`| ${script.id} | ${run.calls} | $${run.costUsd.toFixed(3)} | ${matched}/${expected.length} | ${run.missing.length ? run.missing.join(", ") : "none"} | ${notOk.length ? notOk.join(", ") : "all ok"} |`);
  }
  const day = new Date().toISOString().slice(0, "yyyy-mm-dd".length);
  const report = [
    `# Interview recording, ${day}`,
    "",
    `Model ${env.CLAUDE_MODEL}. Synthetic applicants only. Total cost $${total.toFixed(2)} at the list prices in config/claude-pricing.yaml.`,
    "",
    "| Script | Model calls | Cost | Answers matched | Still missing | Turns not ok |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  fs.mkdirSync(path.resolve("reports"), { recursive: true });
  fs.writeFileSync(path.resolve("reports", `interview-recording-${day}.md`), report);
  console.log(report);
});
