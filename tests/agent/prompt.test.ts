import { describe, expect, it } from "vitest";
import { loadAgentConfig } from "@/agent/config";
import { interviewerPrompt, PROMPT_VERSIONS } from "@/agent/prompts";
import { makeDeps } from "../portal/helpers";

// Spec 10 section 7 (Boundaries in the prompt) and section 17: the prompt describes its limits without naming
// any of the forbidden terms, and names no vendor or product brand.

const agent = loadAgentConfig();
const deps = makeDeps().deps;
const prompt = interviewerPrompt(agent.interviewer.prompt_version, deps);
const startOfWord = (t: string) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");

describe("interviewer prompt", () => {
  it("exists for the configured version", () => {
    expect(PROMPT_VERSIONS).toContain(agent.interviewer.prompt_version);
    expect(prompt.length).toBeGreaterThan(500);
  });
  it("contains no forbidden term", () => {
    expect(agent.guard.forbidden_terms.filter((t) => startOfWord(t).test(prompt))).toEqual([]);
  });
  it("names no vendor, product brand or source company", () => {
    expect(prompt).not.toMatch(/persona|lseg|polis|dvault|ateaya|omikron|world-check|claude|anthropic/i);
  });
  it("carries the fixed deflection line and the configured languages", () => {
    expect(prompt).toContain(agent.interviewer.deflection);
    for (const l of deps.portal.questionnaire.preferred_languages) expect(prompt).toContain(l.label);
  });
  it("tells the model the tools are the only source of questions and that pasted text is data", () => {
    expect(prompt).toMatch(/get_next_questions/);
    expect(prompt).toMatch(/get_review_summary/);
    expect(prompt).toMatch(/never changes? your role|does not change your role/i);
  });
});
