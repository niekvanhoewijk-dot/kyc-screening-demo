import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentConfig } from "@/agent/config";
import { env } from "@/lib/env";
import { ReplayCache } from "@/documents/replay-cache";
import { loadScripts, runScript } from "./scripted-harness";

// Spec 10 sections 12 and 13 (Interviewer): scripted applicants complete the questionnaire in replay.
// The replay half needs real recordings (npm run interview:record, live, costs money) and is skipped until they exist.

const scripts = loadScripts();
const agent = loadAgentConfig();
const terms = new RegExp(`\\b(${agent.guard.forbidden_terms.join("|")})`, "i");

const cacheDir = path.resolve("fixtures/claude-cache");
const recorded = fs.existsSync(cacheDir)
  ? fs.readdirSync(cacheDir).some((f) => f.endsWith(".json") && JSON.parse(fs.readFileSync(path.join(cacheDir, f), "utf8")).kind === "interview")
  : false;

describe("scripted applicants (fixtures/interviews)", () => {
  it("has at least 12, covering every profile, the ID wallet route and four languages", () => {
    expect(scripts.length).toBeGreaterThanOrEqual(12);
    expect(new Set(scripts.map((s) => s.profile))).toEqual(new Set(["cooperative", "vague", "self-contradicting", "hostile", "non-English"]));
    expect(scripts.some((s) => s.route === "wallet")).toBe(true);
    expect(new Set(scripts.map((s) => s.language))).toEqual(new Set(["en", "nl", "el", "de"]));
    expect(scripts.filter((s) => s.steps.some((x) => "expect" in x && x.expect === "deflection")).length).toBeGreaterThanOrEqual(3);
  });

  it("never expects the declaration or a wallet-provided answer to be drafted", () => {
    for (const s of scripts) {
      expect(s.expect.answers).not.toHaveProperty("declaration");
      if (s.route === "wallet") expect(Object.keys(s.expect.answers)).not.toEqual(expect.arrayContaining(["dateOfBirth"]));
    }
  });
});

describe.skipIf(!recorded)("scripted applicants in replay (needs npm run interview:record)", () => {
  for (const script of scripts) {
    it(`${script.id} reaches the review page with the expected answers`, { timeout: 60_000 }, async () => {
      const run = await runScript(script, { mode: "replay", model: env.CLAUDE_MODEL, cache: new ReplayCache() });
      expect(run.turns.map((t) => t.result.outcome).filter((o) => o === "not_recorded")).toEqual([]);
      for (const t of run.turns) expect({ say: t.say, leak: terms.test(t.result.reply) }).toEqual({ say: t.say, leak: false });
      if (script.language === "en")
        for (const t of run.turns.filter((x) => x.expect === "deflection")) expect({ say: t.say, reply: t.result.reply }).toEqual({ say: t.say, reply: expect.stringContaining(agent.interviewer.deflection) });
      expect(run.drafts).not.toHaveProperty("declaration");
      expect(run.missing).toEqual([]);
      expect(Object.fromEntries(Object.keys(script.expect.answers).map((k) => [k, run.drafts[k] ?? null]))).toEqual(script.expect.answers);
      for (const k of script.expect.present) expect(String(run.drafts[k] ?? "").length).toBeGreaterThan(0);
    });
  }
});
