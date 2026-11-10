import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { auditLog } from "@/db/schema";
import { callTool, defineRegistry, defineTool } from "@/agent/registry";
import { applicantRegistry } from "@/agent/tools/applicant";
import { applicantAt, call, ctxFor } from "./helpers";

// Spec 10 principle P7 and section 13 (Scope): one scope per token, the case always comes from the actor.

describe("tool scope", () => {
  it("refuses a tool of the other scope", async () => {
    const a = await applicantAt("questionnaire");
    const analystOnly = defineTool({
      name: "list_cases",
      scope: "analyst",
      description: "Test stub of an analyst read tool.",
      input: z.object({}).strict(),
      output: z.object({ n: z.number() }).strict(),
      readOnly: true,
      handler: async () => ({ n: 1 }),
    });
    const mixed = defineRegistry([...applicantRegistry.tools, analystOnly]);
    expect(await callTool(mixed, ctxFor(a), "list_cases", {})).toEqual({ ok: false, error: { code: "scope", message: "This tool is not available here." } });
    const denied = a.deps.db.select().from(auditLog).where(eq(auditLog.action, "agent.tool_denied")).all();
    expect(denied.at(-1)?.payload).toMatchObject({ tool: "list_cases", reason: "scope" });
  });

  it("does not know tools outside the registry", async () => {
    const a = await applicantAt("questionnaire");
    expect(await call(ctxFor(a), "submit_application", {})).toEqual({ ok: false, error: { code: "unknown_tool", message: "This tool is not available here." } });
  });

  it("takes no case id from the caller: inputs are strict", async () => {
    const a = await applicantAt("questionnaire");
    const other = await applicantAt("questionnaire", { email: "other.applicant@example.test", deps: a });
    for (const [name, input] of [
      ["get_application_status", { caseId: other.current().id }],
      ["get_review_summary", { caseId: other.current().id }],
      ["save_answers", { caseId: other.current().id, answers: { phone: "+30 690 000 0000" } }],
    ] as const) {
      const r = await call(ctxFor(a), name, input);
      expect({ name, r }).toEqual({ name, r: { ok: false, error: { code: "invalid_input", message: expect.any(String) } } });
    }
  });

  it("refuses a context case that belongs to another applicant", async () => {
    const a = await applicantAt("questionnaire");
    const other = await applicantAt("questionnaire", { email: "other.applicant@example.test", deps: a });
    const r = await call({ ...ctxFor(a), caseId: other.current().id }, "get_review_summary", {});
    expect(r).toEqual({ ok: false, error: { code: "scope", message: "This tool is not available here." } });
  });

  it("applicant tools reach neither the rules engine nor the console actions", () => {
    const src = fs.readFileSync(path.resolve("src/agent/tools/applicant.ts"), "utf8");
    expect(src).not.toMatch(/from\s+"@\/engine"|from\s+"@\/engine\//);
    expect(src).not.toMatch(/@\/console\/actions/);
    expect(src).not.toMatch(/scoreCase|scoreApplicant|initialThreshold/);
  });
});
