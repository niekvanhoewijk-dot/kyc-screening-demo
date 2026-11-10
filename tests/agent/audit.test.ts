import { describe as suite, expect, it } from "vitest";
import { auditLog } from "@/db/schema";
import { describe } from "@/app/analyst/audit-text";
import { saveQuestionnaire } from "@/portal/cases";
import { questionnaire } from "../portal/helpers";
import { agentAnswers, applicantAt, call, ctxFor } from "./helpers";

// Spec 10 section 9: every agent action is audited with ids, hashes and counts, and reads as plain English in the console.

suite("agent audit trail", () => {
  it("writes each new action, never with an answer value, and describes it in plain English", async () => {
    const a = await applicantAt("questionnaire");
    const ctx = ctxFor(a, "mcp", { id: "client-1", name: "Sample client" });
    const max = a.deps.agent.tools.save_answers.max_fields_per_call;
    await call(ctx, "get_next_questions", {});
    await call(ctx, "save_answers", { answers: Object.fromEntries(Object.entries(agentAnswers).slice(0, max)) });
    await call(ctx, "save_answers", { answers: { declaration: "on" } });
    await call(ctx, "submit_application", {});
    await call(ctx, "request_secure_step", { step: "review" });
    saveQuestionnaire(a.deps, a.current(), questionnaire);

    const rows = a.deps.db.select().from(auditLog).all();
    for (const action of ["agent.tool_called", "agent.tool_denied", "agent.secure_step_requested", "answers.confirmed"]) {
      const row = rows.find((r) => r.action === action);
      expect({ action, written: !!row }).toEqual({ action, written: true });
      const text = describe({ action, actor: row!.actor, payload: row!.payload });
      expect({ action, text }).not.toEqual({ action, text: action });
      expect(text).toMatch(/^[A-Z].*\.$/);
    }
    const payloads = JSON.stringify(rows.filter((r) => r.action.startsWith("agent.") || r.action === "answers.confirmed").map((r) => r.payload));
    for (const value of ["1990-05-01", "690", "SAMPLE-TIN", "lt_20k", "salary"]) expect(payloads).not.toContain(value);
  });
});
