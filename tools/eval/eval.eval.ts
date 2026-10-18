// Eval report: npm run eval            (replays recorded responses; no API key needed)
//              EVAL_MODE=live npm run eval   (calls the API and records)
import { it } from "vitest";
import { env } from "@/lib/env";
import { runEval } from "@/eval/run";
import { poi, por } from "../../tests/documents/extractions";

it("writes the eval report", { timeout: 20 * 60_000 }, async () => {
  const mode = process.env.EVAL_MODE === "live" ? "live" : "replay";
  const { summary, files } = await runEval({ model: env.CLAUDE_MODEL, mode, clean: { poi: poi(), por: por() }, outDir: "reports", now: new Date() });
  console.log(`\nEvaluated ${summary.documents.evaluated} of ${summary.documents.total} documents. Report: ${files.join(", ")}`);
});
