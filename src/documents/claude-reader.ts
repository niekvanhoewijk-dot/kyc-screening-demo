import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { loadKybConfig, uploadableItems, type KybConfig } from "@/engine";
import { sha256 } from "@/lib/ids";
import type { DocumentReadingConfig } from "./config";
import { kybClassificationSchema, MEMO_MAX_WORDS, memoDraftSchema, wordCount, type KybClassification, type MemoDraft } from "./kyb-schemas";
import { kybInstruction, MEMO_SYSTEM_PROMPT, SYSTEM_PROMPT, USER_INSTRUCTION } from "./prompt";
import type { CallKind, CallLog, DocumentInput, DocumentKind, DocumentReader, MemoWriter, ReadOutcome } from "./reader";
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

export type ClaudeReaderOptions = {
  model: string;
  mode: "live" | "replay";
  config: DocumentReadingConfig;
  parse?: ParseCall; // required in live mode
  cache?: ReplayCache;
  kyb?: KybConfig;
  /** Every call (and replay) is reported here for the audit trail. */
  log?: (entry: CallLog) => void;
};

type Task<T> = {
  kind: CallKind;
  inputSha: string;
  system: string;
  content: Anthropic.Beta.Messages.BetaContentBlockParam[];
  schema: z.ZodType<T>;
  /** Checks the JSON schema cannot express; return problems, empty = valid. */
  extra?: (value: T) => string[];
};

export class ClaudeDocumentReader implements DocumentReader, MemoWriter {
  private readonly cache: ReplayCache;
  private readonly kyb: KybConfig;

  constructor(private readonly opts: ClaudeReaderOptions) {
    this.cache = opts.cache ?? new ReplayCache();
    this.kyb = opts.kyb ?? loadKybConfig();
    if (opts.mode === "live" && !opts.parse) throw new Error("live mode needs a parse call");
  }

  readPoi(doc: DocumentInput) {
    return this.run<PoiExtraction>(this.docTask("poi", doc, poiExtractionSchema, USER_INSTRUCTION.poi, (x) => validateExtraction(x)));
  }

  readPor(doc: DocumentInput) {
    return this.run<PorExtraction>(this.docTask("por", doc, porExtractionSchema, USER_INSTRUCTION.por, (x) => validateExtraction(x)));
  }

  readKyb(doc: DocumentInput) {
    const unit = (x: KybClassification) => (x.overall_confidence >= 0 && x.overall_confidence <= 1 ? [] : ["overall_confidence outside 0-1"]);
    return this.run<KybClassification>(this.docTask("kyb", doc, kybClassificationSchema(this.kyb), kybInstruction(uploadableItems(this.kyb)), unit));
  }

  draftMemo(facts: unknown): Promise<ReadOutcome<MemoDraft>> {
    const text = JSON.stringify(facts, null, 2);
    return this.run<MemoDraft>({
      kind: "memo",
      inputSha: sha256(text),
      system: MEMO_SYSTEM_PROMPT,
      content: [{ type: "text", text: `Case facts (JSON):\n${text}` }],
      schema: memoDraftSchema,
      extra: (m) => (wordCount(m.summary) > MEMO_MAX_WORDS ? [`summary has ${wordCount(m.summary)} words, max ${MEMO_MAX_WORDS}`] : []),
    });
  }

  /** Cache key: same model, prompt version, task kind and input bytes -> same recorded answer. */
  cacheKey(kind: CallKind, doc: { sha256: string }) {
    return sha256([this.opts.model, this.opts.config.prompt_version, kind, doc.sha256].join("|"));
  }

  private docTask<T>(kind: DocumentKind, doc: DocumentInput, schema: z.ZodType<T>, instruction: string, extra: (x: T) => string[]): Task<T> {
    const data = doc.bytes.toString("base64");
    const block: Anthropic.Beta.Messages.BetaContentBlockParam =
      doc.mime === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : { type: "image", source: { type: "base64", media_type: doc.mime as "image/png" | "image/jpeg", data } };
    return { kind, inputSha: doc.sha256, system: SYSTEM_PROMPT, content: [block, { type: "text", text: instruction }], schema, extra };
  }

  private check<T>(task: Task<T>, output: unknown): { ok: true; value: T } | { ok: false; error: string } {
    if (output === null || output === undefined) return { ok: false, error: "No structured output returned." };
    const parsed = task.schema.safeParse(output);
    if (!parsed.success) return { ok: false, error: `Schema validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
    const problems = task.extra?.(parsed.data) ?? [];
    if (problems.length) return { ok: false, error: `Invalid values: ${problems.join("; ")}` };
    return { ok: true, value: parsed.data };
  }

  private async run<T>(task: Task<T>): Promise<ReadOutcome<T>> {
    const { config, model } = this.opts;
    const key = this.cacheKey(task.kind, { sha256: task.inputSha });
    const calls: CallLog[] = [];
    const base = { reader: "claude", kind: task.kind, modelRequested: model, promptVersion: config.prompt_version, inputHash: key };
    const record = (entry: CallLog) => {
      calls.push(entry);
      this.opts.log?.(entry);
    };

    if (this.opts.mode === "replay") {
      const hit = this.cache.get(key);
      if (!hit) {
        record({ ...base, source: "replay", model: null, attempt: 0, stopReason: null, usage: null, outcome: "replay_miss" });
        return { status: "failed", error: "No recorded response for this input (replay mode).", calls };
      }
      const checked = this.check(task, hit.output);
      record({ ...base, source: "replay", model: hit.model, attempt: 0, stopReason: hit.stop_reason, usage: hit.usage, outcome: checked.ok ? "ok" : "invalid", detail: checked.ok ? undefined : checked.error, output: hit.output });
      return checked.ok ? { status: "ok", extraction: checked.value, calls } : { status: "failed", error: checked.error, calls };
    }

    let lastError = "unknown error";
    for (let attempt = 1; attempt <= config.max_attempts; attempt++) {
      try {
        const res = await this.opts.parse!(this.request(task));
        if (res.stop_reason === "refusal") {
          lastError = "The model declined this request.";
          record({ ...base, source: "live", model: res.model, attempt, stopReason: res.stop_reason, usage: res.usage, outcome: "refusal" });
          continue;
        }
        const checked = this.check(task, res.parsed_output);
        record({ ...base, source: "live", model: res.model, attempt, stopReason: res.stop_reason, usage: res.usage, outcome: checked.ok ? "ok" : "invalid", detail: checked.ok ? undefined : checked.error, output: res.parsed_output });
        if (!checked.ok) {
          lastError = checked.error;
          continue;
        }
        this.cache.put({
          key,
          kind: task.kind,
          model_requested: model,
          model: res.model,
          prompt_version: config.prompt_version,
          input_sha256: task.inputSha,
          recorded_at: new Date().toISOString(),
          stop_reason: res.stop_reason,
          usage: res.usage,
          output: res.parsed_output,
        });
        return { status: "ok", extraction: checked.value, calls };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        record({ ...base, source: "live", model: null, attempt, stopReason: null, usage: null, outcome: "error", detail: lastError });
        // Auth, bad request and similar will not improve on retry. (The SDK already retries 429/5xx.)
        if (e instanceof Anthropic.APIError && e.status !== undefined && NON_RETRYABLE.has(e.status)) break;
      }
    }
    return { status: "failed", error: `${task.kind === "memo" ? "Claude call failed" : "Extraction failed"}: ${lastError}`, calls };
  }

  private request<T>(task: Task<T>): ParseParams {
    const { config, model } = this.opts;
    return {
      model,
      max_tokens: config.max_tokens,
      // No temperature: current models reject non-default sampling values (see 07, O-20).
      system: [{ type: "text", text: task.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: task.content }],
      output_config: { effort: config.effort, format: betaZodOutputFormat(task.schema as z.ZodType) },
      ...(config.refusal_fallbacks === "default" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    };
  }
}
