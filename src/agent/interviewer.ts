import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auditLog } from "@/db/schema";
import { ReplayCache } from "@/documents/replay-cache";
import { canonicalJson } from "@/engine";
import { callCost, loadClaudePricing, type Usage } from "@/eval/metrics";
import { audit } from "@/lib/audit";
import { sha256 } from "@/lib/ids";
import { getCurrentCase, stepCase, type CaseRow } from "@/portal/cases";
import type { PortalDeps } from "@/portal/deps";
import { PortalError } from "@/portal/errors";
import { resumeStep } from "@/portal/steps";
import { checkReply } from "./guard";
import { interviewerPrompt } from "./prompts";
import { callTool, toAnthropicTools, type ToolContext } from "./registry";
import { applicantRegistry, openQuestionIdsFor } from "./tools/applicant";

// The interviewer (docs/spec/10 section 7): Claude asks the questionnaire through the applicant tools.
// The rules engine decides; this loop only converses, calls tools and returns the reply the page shows.
// No chat text is stored (O-80): the browser keeps the conversation and sends earlier turns as plain text.

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

/** The one SDK call the loop makes; injectable so tests run without the API. */
export type CreateCall = (params: Params) => Promise<Message>;
export const sdkCreateCall = (client = new Anthropic()): CreateCall => (params) => client.beta.messages.create(params) as Promise<Message>;

export type InterviewModel = { mode: "live" | "replay"; model: string; create?: CreateCall; cache?: ReplayCache };
export type ChatTurn = { role: "user" | "assistant"; text: string };
export type Card = { kind: "identity" | "residence" | "review" | "submit"; href: string };
export type TurnOutcome = "ok" | "blocked" | "refusal" | "capped" | "not_recorded" | "failed";
export type TurnResult = { reply: string; outcome: TurnOutcome; cap?: "turns" | "tool_calls" | "cost"; card: Card | null };

const KIND = "interview";

// ---------- History from the browser ----------

const turnSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string() }).strict();
const UNREADABLE = "The conversation could not be read. Please start again, or continue with the form.";

/** Earlier turns as plain text only: alternating, starting with the applicant, ending with the assistant. */
export function parseHistory(raw: unknown, maxChars = Number.POSITIVE_INFINITY): ChatTurn[] {
  const r = z.array(turnSchema).safeParse(raw);
  if (!r.success) throw new PortalError("VALIDATION", UNREADABLE);
  r.data.forEach((t, i) => {
    const expected = i % 2 === 0 ? "user" : "assistant";
    if (t.role !== expected || t.text.length > maxChars) throw new PortalError("VALIDATION", UNREADABLE);
  });
  if (r.data.length % 2 !== 0) throw new PortalError("VALIDATION", UNREADABLE);
  return r.data;
}

// ---------- Replay key ----------

/** Date-times in tool results (a link's expiry) change from run to run; the key ignores them. */
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;

export function interviewKey(model: string, promptVersion: string, params: Params): string {
  const request = { system: params.system, tools: params.tools, messages: params.messages, max_tokens: params.max_tokens, output_config: params.output_config };
  return sha256(canonicalJson({ kind: KIND, model, prompt_version: promptVersion, request }).replace(ISO_TIME, "<time>"));
}

// ---------- Cards and spend ----------

/** The secure step the page offers below the chat, from the case state alone (never from the model). */
export function cardFor(deps: PortalDeps, c: CaseRow): Card | null {
  if (c.status !== "draft") return null;
  const step = resumeStep(stepCase(c));
  if (step === "identity") return { kind: "identity", href: "/apply/identity?via=assistant" };
  if (step === "residence") return { kind: "residence", href: "/apply/residence?via=assistant" };
  if (step === "questionnaire") return openQuestionIdsFor(deps, c).length === 0 ? { kind: "review", href: "/apply/questionnaire?review=1" } : null;
  if (step === "check") return { kind: "submit", href: "/apply/status" };
  return null;
}

/** Model spend so far on this case, from the audited calls. */
function spentUsd(deps: PortalDeps, caseId: string): number {
  return deps.db
    .select({ payload: auditLog.payload })
    .from(auditLog)
    .where(and(eq(auditLog.entity, `case:${caseId}`), eq(auditLog.action, "claude.call")))
    .all()
    .map((r) => r.payload as { kind?: string; costUsd?: number } | null)
    .filter((p) => p?.kind === KIND)
    .reduce((sum, p) => sum + (p?.costUsd ?? 0), 0);
}

let pricing: ReturnType<typeof loadClaudePricing> | undefined;
const costOf = (model: string, usage: unknown) => callCost(usage as Usage, (pricing ??= loadClaudePricing()).models[model]) ?? 0;

// ---------- The turn ----------

export async function runTurn(deps: PortalDeps, input: { applicantId: string; history: unknown; message: string }, model: InterviewModel): Promise<TurnResult> {
  const cfg = deps.agent.interviewer;
  const history = parseHistory(input.history, cfg.max_message_chars);
  const text = input.message.trim();
  if (!text || text.length > cfg.max_message_chars) throw new PortalError("VALIDATION", "Please write a shorter message.");
  const c = getCurrentCase(deps, input.applicantId);
  if (c.persona !== "individual") throw new PortalError("VALIDATION", "The assistant helps with applications for individuals only. Please use the form.");

  const actor = `applicant:${input.applicantId}` as const;
  const entity = `case:${c.id}`;
  const ctx: ToolContext = { deps, actor, caseId: c.id, channel: "portal" };
  const finish = (reply: string, outcome: TurnOutcome, extra: Partial<TurnResult> = {}): TurnResult => ({ reply, outcome, ...extra, card: cardFor(deps, getCurrentCase(deps, input.applicantId)) });
  const capped = (cap: NonNullable<TurnResult["cap"]>) => {
    audit(deps.db, deps.now(), actor, "agent.cap_reached", entity, { cap, promptVersion: cfg.prompt_version });
    return finish(cfg.capped, "capped", { cap });
  };

  if (history.length === 0)
    audit(deps.db, deps.now(), actor, "agent.conversation_started", entity, { channel: "portal", promptVersion: cfg.prompt_version, language: (c.questionnaire as { preferredLanguage?: string } | null)?.preferredLanguage ?? null });
  if (history.filter((t) => t.role === "user").length >= cfg.max_turns) return capped("turns");

  const system = interviewerPrompt(cfg.prompt_version, deps);
  const tools = toAnthropicTools(applicantRegistry, "applicant") as unknown as Anthropic.Beta.Messages.BetaTool[];
  const messages: MessageParam[] = [...history.map((t) => ({ role: t.role, content: t.text })), { role: "user", content: text }];
  const cache = model.cache ?? new ReplayCache();
  let toolCalls = 0;

  for (;;) {
    if (spentUsd(deps, c.id) >= cfg.max_cost_usd_per_case) return capped("cost");
    const params: Params = {
      model: model.model,
      max_tokens: cfg.max_tokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools,
      messages: structuredClone(messages),
      output_config: { effort: cfg.effort },
      ...(cfg.refusal_fallbacks === "default" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    };
    const key = interviewKey(model.model, cfg.prompt_version, params);
    const base = { kind: KIND, promptVersion: cfg.prompt_version, inputHash: key, attempt: 1 };

    let res: Message;
    let source: "live" | "replay" = model.mode;
    try {
      if (model.mode === "replay") {
        const hit = cache.get(key);
        if (!hit) {
          audit(deps.db, deps.now(), "claude", "claude.call", entity, { ...base, source, model: null, outcome: "not_recorded" });
          return finish(cfg.not_recorded, "not_recorded");
        }
        res = { content: hit.output, stop_reason: hit.stop_reason, model: hit.model, usage: hit.usage } as unknown as Message;
      } else {
        if (!model.create) throw new Error("live mode needs a create call");
        res = await model.create(params);
        cache.put({ key, kind: KIND, model_requested: model.model, model: res.model, prompt_version: cfg.prompt_version, input_sha256: key, recorded_at: new Date().toISOString(), stop_reason: res.stop_reason, usage: res.usage, output: res.content });
      }
    } catch (e) {
      source = model.mode;
      audit(deps.db, deps.now(), "claude", "claude.call", entity, { ...base, source, model: null, outcome: "error", detail: e instanceof Anthropic.APIError ? `API ${e.status}` : "call failed" });
      return finish(cfg.failed, "failed");
    }

    const uses = res.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    audit(deps.db, deps.now(), "claude", "claude.call", entity, {
      ...base,
      source,
      model: res.model,
      stopReason: res.stop_reason,
      outcome: res.stop_reason === "refusal" ? "refusal" : "ok",
      usage: res.usage,
      costUsd: costOf(model.model, res.usage),
      tools: uses.map((u) => u.name),
    });

    if (res.stop_reason === "refusal") return finish(cfg.deflection, "refusal");
    if (res.stop_reason === "tool_use" && uses.length) {
      if (toolCalls + uses.length > cfg.max_tool_calls_per_turn) return capped("tool_calls");
      // The assistant turn goes back unchanged (thinking blocks included); all results in one user message.
      messages.push({ role: "assistant", content: res.content as unknown as Anthropic.Beta.Messages.BetaContentBlockParam[] });
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        const r = await callTool(applicantRegistry, ctx, u.name, u.input);
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(r.ok ? r.output : { error: r.error.message }), ...(r.ok ? {} : { is_error: true }) });
      }
      toolCalls += uses.length;
      messages.push({ role: "user", content: results });
      continue;
    }

    const reply = res.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!reply) return finish(cfg.failed, "failed");
    const check = checkReply(reply, deps);
    if (!check.ok) {
      audit(deps.db, deps.now(), actor, "agent.output_blocked", entity, { termCount: check.termCount, promptVersion: cfg.prompt_version });
      return finish(cfg.deflection, "blocked");
    }
    return finish(reply.slice(0, cfg.max_message_chars), "ok");
  }
}
