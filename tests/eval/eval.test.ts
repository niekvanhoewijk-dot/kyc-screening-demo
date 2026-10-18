import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeDocumentReader, type ParseCall } from "@/documents/claude-reader";
import { loadDocumentReadingConfig } from "@/documents/config";
import { ReplayCache } from "@/documents/replay-cache";
import { callCost, perCodeStats } from "@/eval/metrics";
import { runEval } from "@/eval/run";
import { poi, por } from "../documents/extractions";

describe("eval metrics", () => {
  it("computes precision and recall per code", () => {
    const rows = [
      { id: "a", expected: ["POI_EXPIRED"], fired: ["POI_EXPIRED"], evaluated: true },
      { id: "b", expected: ["POI_EXPIRED"], fired: [], evaluated: true },
      { id: "c", expected: [], fired: ["POI_EXPIRED", "POR_PO_BOX"], evaluated: true },
      { id: "d", expected: ["POR_PO_BOX"], fired: [], evaluated: false }, // not recorded: ignored
    ];
    const s = perCodeStats(rows, ["POI_EXPIRED", "POR_PO_BOX", "POR_MOBILE_BILL"]);
    expect(s.find((x) => x.code === "POI_EXPIRED")).toMatchObject({ tp: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5 });
    expect(s.find((x) => x.code === "POR_PO_BOX")).toMatchObject({ tp: 0, fp: 1, fn: 0, precision: 0, recall: null });
    expect(s.map((x) => x.code)).not.toContain("POR_MOBILE_BILL");
  });

  it("prices a call from usage and returns null for unknown models", () => {
    const price = { input: 2, output: 10, cache_write: 2.5, cache_read: 0.2 };
    expect(callCost({ input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000 }, price)).toBeCloseTo(2 + 1 + 0.2);
    expect(callCost({ input_tokens: 5 }, undefined)).toBeNull();
  });
});

describe("eval runner (fake API)", () => {
  it("evaluates both labelled sets and writes Markdown and JSON reports", async () => {
    const usage = { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 1500 };
    const parse: ParseCall = async (p) => {
      const text = JSON.stringify(p.messages);
      const out = text.includes("proof-of-identity") ? poi() : text.includes("proof-of-residence") ? por()
        : { document_type: "certificate_of_incorporation", company_name: "Sample Holdings B.V.", registration_number: "SAMPLE-12345", registered_address: null, issue_date: null, persons: [], issues: [], issue_notes: "", overall_confidence: 0.9 };
      return { parsed_output: out, stop_reason: "end_turn", model: "claude-sonnet-5-5", usage };
    };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-"));
    const cache = new ReplayCache(fs.mkdtempSync(path.join(os.tmpdir(), "cache-")));
    const { summary, files } = await runEval({
      model: "claude-sonnet-5-5",
      mode: "live",
      clean: { poi: poi(), por: por() },
      outDir,
      now: new Date("2026-10-18T12:00:00Z"),
      reader: (log) => new ClaudeDocumentReader({ model: "claude-sonnet-5-5", mode: "live", config: loadDocumentReadingConfig(), parse, cache, log }),
    });
    expect(summary.documents).toMatchObject({ total: 25, evaluated: 25, not_recorded: 0 });
    // A reader that always returns a clean extraction misses every expected code: recall 0, no false positives.
    const expired = summary.per_code.find((c) => c.code === "POI_EXPIRED");
    expect(expired).toMatchObject({ tp: 0, fn: 1, recall: 0 });
    expect(summary.cost.individual_case).toBeGreaterThan(0);
    expect(fs.readFileSync(files[0]!, "utf8")).toMatch(/\| POI_EXPIRED \| 1 \| 0 \| 0 \| 1 \|/);
  });

  it("reports nothing evaluated, not a pass, when no responses are recorded", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-"));
    const cache = new ReplayCache(fs.mkdtempSync(path.join(os.tmpdir(), "cache-")));
    const { summary } = await runEval({
      model: "claude-sonnet-5-5", mode: "replay", clean: { poi: poi(), por: por() }, outDir, now: new Date(),
      reader: (log) => new ClaudeDocumentReader({ model: "claude-sonnet-5-5", mode: "replay", config: loadDocumentReadingConfig(), cache, log }),
    });
    expect(summary.documents).toMatchObject({ evaluated: 0, not_recorded: 25 });
    expect(summary.per_code).toEqual([]);
  });
});
