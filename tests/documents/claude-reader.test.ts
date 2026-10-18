import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ClaudeDocumentReader, type ParseCall } from "@/documents/claude-reader";
import { loadDocumentReadingConfig } from "@/documents/config";
import type { CallLog } from "@/documents/reader";
import { ReplayCache } from "@/documents/replay-cache";
import { sha256 } from "@/lib/ids";
import { poi } from "./extractions";

const config = loadDocumentReadingConfig();
const doc = { bytes: Buffer.from("SAMPLE poi"), mime: "image/png", sha256: sha256("SAMPLE poi") };
const tmpCache = () => new ReplayCache(fs.mkdtempSync(path.join(os.tmpdir(), "claude-cache-")));
const reply = (parsed_output: unknown, stop_reason = "end_turn") => ({ parsed_output, stop_reason, model: "claude-sonnet-5-5", usage: { input_tokens: 1, output_tokens: 1 } });

function fakeParse(...responses: (ReturnType<typeof reply> | Error)[]) {
  const requests: Parameters<ParseCall>[0][] = [];
  const parse: ParseCall = async (params) => {
    requests.push(params);
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    if (next instanceof Error) throw next;
    return next;
  };
  return { parse, requests };
}

const reader = (parse: ParseCall, cache = tmpCache(), logs: CallLog[] = []) =>
  new ClaudeDocumentReader({ model: "claude-sonnet-5-5", mode: "live", config, parse, cache, log: (l) => logs.push(l) });

describe("ClaudeDocumentReader (live, fake API)", () => {
  it("returns a validated extraction, records the call and writes the replay cache", async () => {
    const cache = tmpCache();
    const logs: CallLog[] = [];
    const { parse, requests } = fakeParse(reply(poi()));
    const r = reader(parse, cache, logs);
    const out = await r.readPoi(doc);
    expect(out.status).toBe("ok");
    expect(logs).toMatchObject([{ source: "live", outcome: "ok", attempt: 1, promptVersion: config.prompt_version, model: "claude-sonnet-5-5" }]);
    expect(cache.get(r.cacheKey("poi", doc))?.output).toEqual(poi());

    const req = requests[0]!;
    expect(req).not.toHaveProperty("temperature");
    expect(req).not.toHaveProperty("tool_choice");
    expect(JSON.stringify(req.system)).toContain("untrusted");
    expect(req.messages[0]!.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image" })]));
  });

  it("sends PDFs as document blocks", async () => {
    const { parse, requests } = fakeParse(reply(poi()));
    await reader(parse).readPoi({ ...doc, mime: "application/pdf" });
    expect(requests[0]!.messages[0]!.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "document" })]));
  });

  it("retries once on invalid output, then succeeds", async () => {
    const logs: CallLog[] = [];
    const { parse } = fakeParse(reply({ nonsense: true }), reply(poi()));
    const out = await reader(parse, tmpCache(), logs).readPoi(doc);
    expect(out.status).toBe("ok");
    expect(logs.map((l) => l.outcome)).toEqual(["invalid", "ok"]);
  });

  it("gives up after the configured attempts and reports extraction failed", async () => {
    const { parse } = fakeParse(reply(poi({ overall_confidence: 7 })), reply(null));
    const out = await reader(parse).readPoi(doc);
    expect(out).toMatchObject({ status: "failed", error: expect.stringMatching(/Extraction failed/) });
    expect(out.calls).toHaveLength(config.max_attempts);
  });

  it("treats a refusal as a failed attempt", async () => {
    const { parse } = fakeParse(reply(null, "refusal"), reply(poi()));
    const out = await reader(parse).readPoi(doc);
    expect(out.calls.map((c) => c.outcome)).toEqual(["refusal", "ok"]);
  });

  it("does not retry non-retryable API errors", async () => {
    const auth = new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", new Headers());
    const { parse } = fakeParse(auth, reply(poi()));
    const out = await reader(parse).readPoi(doc);
    expect(out.status).toBe("failed");
    expect(out.calls).toHaveLength(1);
  });
});

describe("ClaudeDocumentReader (replay)", () => {
  it("serves a recorded response without calling the API, and misses cleanly", async () => {
    const cache = tmpCache();
    const { parse } = fakeParse(reply(poi()));
    await reader(parse, cache).readPoi(doc);

    const logs: CallLog[] = [];
    const replay = new ClaudeDocumentReader({ model: "claude-sonnet-5-5", mode: "replay", config, cache, log: (l) => logs.push(l) });
    expect(await replay.readPoi(doc)).toMatchObject({ status: "ok", extraction: poi() });
    expect(await replay.readPor(doc)).toMatchObject({ status: "failed" });
    expect(logs.map((l) => [l.source, l.outcome])).toEqual([["replay", "ok"], ["replay", "replay_miss"]]);
  });

  it("keys the cache by model and prompt version", () => {
    const a = new ClaudeDocumentReader({ model: "m1", mode: "replay", config });
    const b = new ClaudeDocumentReader({ model: "m2", mode: "replay", config });
    expect(a.cacheKey("poi", doc)).not.toBe(b.cacheKey("poi", doc));
  });
});
