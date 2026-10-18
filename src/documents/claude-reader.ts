import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { sha256 } from "@/lib/ids";
import type { DocumentReadingConfig } from "./config";
import { SYSTEM_PROMPT, USER_INSTRUCTION } from "./prompt";
import type { CallLog, DocumentInput, DocumentKind, DocumentReader, ReadOutcome } from "./reader";
import { ReplayCache } from "./replay-cache";
import { poiExtractionSchema, porExtractionSchema, validateExtraction, type PoiExtraction, type PorExtraction } from "./schemas";

type ParseParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type ParseResult = { parsed_output: unknown; stop_reason: string | null; model: string; usage: unknown };
/** The one SDK call this reader makes; injectable so tests run without the API. */
export type ParseCall = (params: ParseParams) => Promise<ParseResult>;

export function sdkParseCall(client = new Anthropic()): ParseCall {
  return (params) => client.beta.messages.parse(params) as Promise<ParseResult>;
}

const NON_RETRYABLE = new Set([400, 401, 403, 404, 413]);
const SCHEMAS = { poi: poiExtractionSchema, por: porExtractionSchema } as const;

export type ClaudeReaderOptions = {
  model: string;
  mode: "live" | "replay";
  config: DocumentReadingConfig;
  parse?: ParseCall; // required in live mode
  cache?: ReplayCache;
  /** Every call (and replay) is reported here for the audit trail. */
  log?: (entry: CallLog) => void;
};

export class ClaudeDocumentReader implements DocumentReader {
  private readonly cache: ReplayCache;

  constructor(private readonly opts: ClaudeReaderOptions) {
    this.cache = opts.cache ?? new ReplayCache();
    if (opts.mode === "live" && !opts.parse) throw new Error("live mode needs a parse call");
  }

  readPoi(doc: DocumentInput) {
    return this.read<PoiExtraction>("poi", doc);
  }

  readPor(doc: DocumentInput) {
    return this.read<PorExtraction>("por", doc);
  }

  /** Cache key: same model, prompt version, document kind and bytes -> same recorded answer. */
  cacheKey(kind: DocumentKind, doc: DocumentInput) {
    return sha256([this.opts.model, this.opts.config.prompt_version, kind, doc.sha256].join("|"));
  }

  private async read<T>(kind: DocumentKind, doc: DocumentInput): Promise<ReadOutcome<T>> {
    const { config, model } = this.opts;
    const key = this.cacheKey(kind, doc);
    const calls: CallLog[] = [];
    const base = { reader: "claude", kind, modelRequested: model, promptVersion: config.prompt_version, inputHash: key };
    const record = (entry: CallLog) => {
      calls.push(entry);
      this.opts.log?.(entry);
    };

    if (this.opts.mode === "replay") {
      const hit = this.cache.get(key);
      if (!hit) {
        record({ ...base, source: "replay", model: null, attempt: 0, stopReason: null, usage: null, outcome: "replay_miss" });
        return { status: "failed", error: "No recorded response for this document (replay mode).", calls };
      }
      const checked = this.check(kind, hit.output);
      record({ ...base, source: "replay", model: hit.model, attempt: 0, stopReason: hit.stop_reason, usage: hit.usage, outcome: checked.ok ? "ok" : "invalid", detail: checked.ok ? undefined : checked.error, output: hit.output });
      return checked.ok ? { status: "ok", extraction: checked.value as T, calls } : { status: "failed", error: checked.error, calls };
    }

    let lastError = "unknown error";
    for (let attempt = 1; attempt <= config.max_attempts; attempt++) {
      try {
        const res = await this.opts.parse!(this.request(kind, doc));
        if (res.stop_reason === "refusal") {
          lastError = "The model declined to read this document.";
          record({ ...base, source: "live", model: res.model, attempt, stopReason: res.stop_reason, usage: res.usage, outcome: "refusal" });
          continue;
        }
        const checked = this.check(kind, res.parsed_output);
        record({ ...base, source: "live", model: res.model, attempt, stopReason: res.stop_reason, usage: res.usage, outcome: checked.ok ? "ok" : "invalid", detail: checked.ok ? undefined : checked.error, output: res.parsed_output });
        if (!checked.ok) {
          lastError = checked.error;
          continue;
        }
        this.cache.put({
          key,
          kind,
          model_requested: model,
          model: res.model,
          prompt_version: config.prompt_version,
          input_sha256: doc.sha256,
          recorded_at: new Date().toISOString(),
          stop_reason: res.stop_reason,
          usage: res.usage,
          output: res.parsed_output,
        });
        return { status: "ok", extraction: checked.value as T, calls };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        record({ ...base, source: "live", model: null, attempt, stopReason: null, usage: null, outcome: "error", detail: lastError });
        // Auth, bad request and similar will not improve on retry. (The SDK already retries 429/5xx.)
        if (e instanceof Anthropic.APIError && e.status !== undefined && NON_RETRYABLE.has(e.status)) break;
      }
    }
    return { status: "failed", error: `Extraction failed: ${lastError}`, calls };
  }

  private check(kind: DocumentKind, output: unknown): { ok: true; value: z.infer<(typeof SCHEMAS)[DocumentKind]> } | { ok: false; error: string } {
    if (output === null || output === undefined) return { ok: false, error: "No structured output returned." };
    const parsed = SCHEMAS[kind].safeParse(output);
    if (!parsed.success) return { ok: false, error: `Schema validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
    const problems = validateExtraction(parsed.data);
    if (problems.length) return { ok: false, error: `Invalid values: ${problems.join("; ")}` };
    return { ok: true, value: parsed.data };
  }

  private request(kind: DocumentKind, doc: DocumentInput): ParseParams {
    const { config, model } = this.opts;
    const data = doc.bytes.toString("base64");
    const docBlock: Anthropic.Beta.Messages.BetaContentBlockParam =
      doc.mime === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : { type: "image", source: { type: "base64", media_type: doc.mime as "image/png" | "image/jpeg", data } };
    return {
      model,
      max_tokens: config.max_tokens,
      // No temperature: current models reject non-default sampling values (see 07, O-20).
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [docBlock, { type: "text", text: USER_INSTRUCTION[kind] }] }],
      output_config: { effort: config.effort, format: betaZodOutputFormat(SCHEMAS[kind]) },
      ...(config.refusal_fallbacks === "default" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    };
  }
}
