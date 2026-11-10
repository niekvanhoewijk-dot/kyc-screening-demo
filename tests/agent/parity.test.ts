import { describe, expect, it } from "vitest";
import type { ToolContext } from "@/agent/registry";
import { saveQuestionnaire, submitCase } from "@/portal/cases";
import { questionnaire } from "../portal/helpers";
import { agentAnswers, applicantAt, call, ctxFor } from "./helpers";

// Spec 10 section 13 (Parity) and D23: the channel and provenance never reach the engine.

async function route(kind: "form" | "interviewer" | "mcp", email: string) {
  const a = await applicantAt("questionnaire", { email });
  if (kind !== "form") {
    const ctx: ToolContext = kind === "mcp" ? ctxFor(a, "mcp", { id: "client-1", name: "Sample client" }) : ctxFor(a, "portal");
    const max = a.deps.agent.tools.save_answers.max_fields_per_call;
    const entries = Object.entries(agentAnswers);
    for (let i = 0; i < entries.length; i += max) {
      const r = await call(ctx, "save_answers", { answers: Object.fromEntries(entries.slice(i, i + max)) });
      expect(r).toMatchObject({ ok: true, output: { rejected: [] } });
    }
  }
  // The review page posts the same form as the plain route: the person confirms and ticks the declaration.
  saveQuestionnaire(a.deps, a.current(), questionnaire);
  await submitCase(a.deps, a.current());
  const c = a.current();
  return { riskResult: c.riskResult, thresholdResult: c.thresholdResult, engineVersions: c.engineVersions, answers: { ...(c.questionnaire as Record<string, unknown>), provenance: undefined } };
}

describe("engine parity across intake channels", () => {
  it("gives identical score, threshold and engine versions for the form, the interviewer and MCP", async () => {
    const form = await route("form", "form.route@example.test");
    const interviewer = await route("interviewer", "interviewer.route@example.test");
    const mcp = await route("mcp", "mcp.route@example.test");
    expect(form.riskResult).toBeTruthy();
    expect(interviewer).toEqual(form);
    expect(mcp).toEqual(form);
  });
});
