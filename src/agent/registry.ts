import { z } from "zod";
import { audit } from "@/lib/audit";
import { sha256 } from "@/lib/ids";
import type { PortalDeps } from "@/portal/deps";
import { PortalError } from "@/portal/errors";

// The tool registry (docs/spec/10 section 4.1): one set of tool definitions for every agent channel. Each call goes
// through callTool, which checks scope, validates input and output against strict schemas, and writes the audit entry.
// Handlers hold no business rules: they call the service layer the web forms already use.

export type Scope = "applicant" | "analyst";
export type Channel = "portal" | "mcp";

export type ToolContext = {
  deps: PortalDeps;
  actor: `applicant:${string}` | `analyst:${string}`;
  /** Set by the channel when it knows the case; tools resolve and check it against the actor. */
  caseId?: string;
  channel: Channel;
  client?: { id: string; name: string };
};

export type ToolDef<I = any, O = any> = {
  name: string; // snake_case, stable once published
  scope: Scope;
  description: string; // read by third-party AI clients (spec 10 section 5.3)
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  readOnly: boolean; // the MCP readOnlyHint
  idempotent?: boolean;
  handler: (ctx: ToolContext, input: I) => Promise<O>;
};

export const defineTool = <I, O>(t: ToolDef<I, O>): ToolDef<I, O> => t;

export type Registry = { tools: ToolDef[]; get(name: string): ToolDef | undefined };

export function defineRegistry(tools: ToolDef[]): Registry {
  const names = tools.map((t) => t.name);
  if (new Set(names).size !== names.length) throw new Error("Duplicate tool name in registry");
  return { tools, get: (name) => tools.find((t) => t.name === name) };
}

export type DenyReason = "scope" | "unknown_tool" | "invalid_input" | "step_closed" | "cap";
export type ToolErrorCode = "denied" | "scope" | "unknown_tool" | "invalid_input" | "internal";
export type ToolResult = { ok: true; output: unknown } | { ok: false; error: { code: ToolErrorCode; message: string } };

/** A refusal a tool raises on purpose. The message is plain and safe to show the person. */
export class ToolDenied extends Error {
  constructor(
    readonly reason: DenyReason,
    message: string,
    readonly code: ToolErrorCode = "denied",
  ) {
    super(message);
  }
}

export const NOT_AVAILABLE = "This tool is not available here.";
const BAD_INPUT = "The request does not match this tool. Check the question ids and values.";
const SOMETHING_WRONG = "Something went wrong. Please try again, or use the form.";

const scopeOf = (actor: ToolContext["actor"]): Scope => (actor.startsWith("analyst:") ? "analyst" : "applicant");

export async function callTool(registry: Registry, ctx: ToolContext, name: string, raw: unknown): Promise<ToolResult> {
  const started = Date.now();
  const call: ToolContext = { ...ctx };
  const base = { tool: name, channel: ctx.channel, clientId: ctx.client?.id, clientName: ctx.client?.name };
  const entity = () => (call.caseId ? `case:${call.caseId}` : null);
  const deny = (reason: DenyReason, code: ToolErrorCode, message: string): ToolResult => {
    audit(ctx.deps.db, ctx.deps.now(), ctx.actor, "agent.tool_denied", entity(), { ...base, reason });
    return { ok: false, error: { code, message } };
  };

  const tool = registry.get(name);
  if (!tool) return deny("unknown_tool", "unknown_tool", NOT_AVAILABLE);
  if (tool.scope !== scopeOf(ctx.actor)) return deny("scope", "scope", NOT_AVAILABLE);
  const input = tool.input.safeParse(raw ?? {});
  if (!input.success) return deny("invalid_input", "invalid_input", BAD_INPUT);

  let output: unknown;
  try {
    output = await tool.handler(call, input.data);
  } catch (e) {
    if (e instanceof ToolDenied) return deny(e.reason, e.code, e.message);
    if (e instanceof PortalError && (e.code === "STEP_LOCKED" || e.code === "NOT_EDITABLE")) return deny("step_closed", "denied", e.message);
    throw e;
  }
  const checked = tool.output.safeParse(output);
  const argsHash = sha256(JSON.stringify(raw ?? {}));
  audit(ctx.deps.db, ctx.deps.now(), ctx.actor, "agent.tool_called", entity(), { ...base, argsHash, outcome: checked.success ? "ok" : "output_invalid", ms: Date.now() - started });
  if (!checked.success) return { ok: false, error: { code: "internal", message: SOMETHING_WRONG } };
  return { ok: true, output: checked.data };
}

const jsonSchema = (schema: z.ZodType, io: "input" | "output") => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { io }) as Record<string, unknown>;
  return rest;
};

/** Native tool use (the in-portal interviewer, 10b). */
export function toAnthropicTools(registry: Registry, scope: Scope) {
  return registry.tools.filter((t) => t.scope === scope).map((t) => ({ name: t.name, description: t.description, input_schema: jsonSchema(t.input, "input") }));
}

/** MCP tools/list entries (10c, 10e). */
export function toMcpTools(registry: Registry, scope: Scope) {
  return registry.tools
    .filter((t) => t.scope === scope)
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: jsonSchema(t.input, "input"),
      outputSchema: jsonSchema(t.output, "output"),
      annotations: { readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.readOnly || t.idempotent === true },
    }));
}
