import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

// Agent settings (docs/spec/10 section 10). Everything tunable lives in config/agent.yaml.

const positiveInt = z.number().int().positive();

const text = z.string().min(1);

export const agentConfigSchema = z.object({
  version: z.number().int(),
  interviewer: z.object({
    prompt_version: z.string().regex(/^interviewer-[a-z\d]+$/),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
    max_tokens: positiveInt,
    max_turns: positiveInt,
    max_tool_calls_per_turn: positiveInt,
    max_cost_usd_per_case: z.number().positive(),
    max_message_chars: positiveInt,
    refusal_fallbacks: z.enum(["default", "off"]),
    greeting: text,
    disclosure: text,
    deflection: text,
    capped: text,
    not_recorded: text,
    failed: text,
  }),
  guard: z.object({
    forbidden_terms: z.array(z.string().min(1)).min(1),
    exempt_label_sources: z.array(z.enum(["questionnaire"])),
  }),
  tools: z.object({
    get_next_questions: z.object({ max_questions: positiveInt }),
    save_answers: z.object({ max_fields_per_call: positiveInt }),
    applicant_visible_issues: z.array(z.string()),
  }),
  mcp: z.object({ secure_link_ttl_minutes: positiveInt }),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

let cached: AgentConfig | undefined;
export function loadAgentConfig(file = path.resolve(/* turbopackIgnore: true */ process.cwd(), "config/agent.yaml")): AgentConfig {
  cached ??= agentConfigSchema.parse(parse(fs.readFileSync(file, "utf8")));
  return cached;
}
