import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applicants, auditLog, cases } from "@/db/schema";
import { ClaudeDocumentReader, type ParseCall } from "@/documents/claude-reader";
import { loadDocumentReadingConfig } from "@/documents/config";
import { checkRulesFromConfig } from "@/documents/factory";
import { ReplayCache } from "@/documents/replay-cache";
import type { PreReviewDeps } from "@/documents/pre-review";
import { loadPersonas } from "@/demo/personas";
import { resetDemo } from "@/demo/seed";
import { applicantView } from "@/portal/decision";
import { makeDeps } from "../portal/helpers";
import { poi, por } from "../documents/extractions";

const MODEL = "claude-sonnet-5-5";
const answer: ParseCall = async (p) => {
  const text = JSON.stringify(p.messages);
  const out = text.includes("Case facts") ? { summary: "Synthetic memo.", screening_notes: "", suggested_edd_requests: [], recommended_action: "needs_human_review" }
    : text.includes("proof-of-identity") ? poi() : text.includes("proof-of-residence") ? por()
    : { document_type: "certificate_of_incorporation", company_name: "Sample Holdings B.V.", registration_number: "SAMPLE-12345", registered_address: null, issue_date: null, persons: [], issues: [], issue_notes: "", overall_confidence: 0.9 };
  return { parsed_output: out, stop_reason: "end_turn", model: MODEL, usage: {} };
};

function deps(mode: "live" | "replay", cache: ReplayCache): PreReviewDeps {
  const t = makeDeps();
  return { ...t.deps, checkRules: checkRulesFromConfig(), documentReader: (log) => new ClaudeDocumentReader({ model: MODEL, mode, config: loadDocumentReadingConfig(), parse: mode === "live" ? answer : undefined, cache, log }) };
}
const tmpCache = () => new ReplayCache(fs.mkdtempSync(path.join(os.tmpdir(), "demo-cache-")));

describe("demo seed", () => {
  it("seeds every persona into its expected band through the real portal services", async () => {
    const d = deps("replay", tmpCache());
    const r = await resetDemo(d, { claude: "auto", actor: "cli", model: MODEL, cache: tmpCache() });
    const personas = loadPersonas();
    const expected = [...personas.individuals.map((p) => [p.id, p.expect.band]), [personas.company.id, personas.company.expect.band]];
    expect(r.cases.map((c) => [c.personaId, c.band])).toEqual(expected);

    const rows = d.db.select().from(cases).all();
    const low = rows.find((c) => c.id === r.cases.find((x) => x.personaId === "low")!.caseId)!;
    expect(low.riskResult).toMatchObject({ total: 8 });
    expect(low.thresholdResult).toMatchObject({ threshold: 19999 });
    expect(rows.find((c) => c.id === r.cases.find((x) => x.personaId === "high")!.caseId)!.riskResult).toMatchObject({ band: "high", forced_by: "pep" });
    expect(rows.every((c) => c.status === "submitted" && applicantView(c).kind === "check")).toBe(true);
    // Nothing recorded: Claude is skipped, not faked.
    expect(r.claude).toMatchObject({ preReviews: 0, memos: 0 });
    expect(rows.every((c) => c.preReview === null)).toBe(true);
  });

  it("reset wipes earlier data and is audited", async () => {
    const d = deps("replay", tmpCache());
    await resetDemo(d, { claude: "skip", actor: "cli" });
    await resetDemo(d, { claude: "skip", actor: "analyst-1" });
    expect(d.db.select().from(applicants).all()).toHaveLength(loadPersonas().individuals.length + 1);
    expect(d.db.select().from(auditLog).all().filter((a) => a.action === "demo.reset")).toEqual([expect.objectContaining({ actor: "analyst:analyst-1" })]);
  });

  it("record once live, then every reset replays pre-review and memo offline", async () => {
    const cache = tmpCache();
    const live = await resetDemo(deps("live", cache), { claude: "run", actor: "cli", model: MODEL, cache });
    expect(live.claude).toMatchObject({ preReviews: 6, memos: 6 });

    const offline = deps("replay", cache);
    const r = await resetDemo(offline, { claude: "auto", actor: "cli", model: MODEL, cache });
    expect(r.claude).toMatchObject({ preReviews: 6, memos: 6 });
    const calls = offline.db.select().from(auditLog).all().filter((a) => a.action === "claude.call").map((a) => (a.payload as { source: string; outcome: string }));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.source === "replay" && c.outcome === "ok")).toBe(true);
  });
});
