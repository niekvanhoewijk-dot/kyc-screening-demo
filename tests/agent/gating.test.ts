import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, intakeDrafts } from "@/db/schema";
import { saveQuestionnaire, submitCase } from "@/portal/cases";
import { questionnaire } from "../portal/helpers";
import { agentAnswers, applicantAt, call, ctxFor } from "./helpers";

// Spec 10 section 5.1 rules and section 13 (Gating): the tools use the portal's own gating and messages.

describe("save_answers gating", () => {
  for (const stage of ["overview", "identity", "residence"] as const) {
    it(`is refused with the form's message while the questionnaire is closed (at ${stage})`, async () => {
      const a = await applicantAt(stage);
      const r = await call(ctxFor(a), "save_answers", { answers: { phone: "+30 690 000 0000" } });
      expect(r).toEqual({ ok: false, error: { code: "denied", message: "Please complete the earlier steps first." } });
      expect(a.deps.db.select().from(intakeDrafts).all()).toEqual([]);
      const denied = a.deps.db.select().from(auditLog).where(eq(auditLog.action, "agent.tool_denied")).all();
      expect(denied.at(-1)?.payload).toMatchObject({ tool: "save_answers", reason: "step_closed" });
    });
  }

  it("is refused once the application is submitted", async () => {
    const a = await applicantAt("questionnaire");
    saveQuestionnaire(a.deps, a.current(), questionnaire);
    await submitCase(a.deps, a.current());
    const r = await call(ctxFor(a), "save_answers", { answers: { phone: "+30 690 000 0001" } });
    expect(r).toEqual({ ok: false, error: { code: "denied", message: "Your application has been submitted and can no longer be changed." } });
  });

  it("never sets the declaration: only the person ticks it, on the review page", async () => {
    const a = await applicantAt("questionnaire");
    for (const value of ["on", true, "yes"]) {
      const r = await call(ctxFor(a), "save_answers", { answers: { declaration: value } });
      expect(r).toMatchObject({ ok: true, output: { accepted: [], rejected: [{ field: "declaration" }] } });
    }
    expect(a.deps.db.select().from(intakeDrafts).all()).toEqual([]);
  });

  it("rejects the date of birth and nationality the ID wallet provided (O-76)", async () => {
    const a = await applicantAt("questionnaire", { wallet: true });
    const r = await call(ctxFor(a), "save_answers", { answers: { dateOfBirth: "1990-05-01", nationality: "NL", phone: "+31 6 1234 5678" } });
    expect(r).toEqual({
      ok: true,
      output: expect.objectContaining({
        accepted: ["phone"],
        rejected: [
          { field: "dateOfBirth", message: "Provided by your ID wallet." },
          { field: "nationality", message: "Provided by your ID wallet." },
        ],
      }),
    });
  });

  it("returns the form's own message for an invalid answer, field by field", async () => {
    const a = await applicantAt("questionnaire");
    const r = await call(ctxFor(a), "save_answers", { answers: { phone: "12345", nationality: "XX", deposit_12m: "lots", annual_income: "lt_50k" } });
    expect(r).toEqual({
      ok: true,
      output: expect.objectContaining({
        accepted: ["annual_income"],
        rejected: [
          { field: "phone", message: "Use international format with country code, e.g. +31 6 1234 5678" },
          { field: "nationality", message: "Choose a valid nationality" },
          { field: "deposit_12m", message: "Choose a valid expected deposit" },
        ],
      }),
    });
  });

  it("rejects questions that are not part of the application", async () => {
    const a = await applicantAt("questionnaire");
    const r = await call(ctxFor(a), "save_answers", { answers: { favouriteColour: "blue" } });
    expect(r).toMatchObject({ ok: true, output: { accepted: [], rejected: [{ field: "favouriteColour", message: "This question is not part of the application." }] } });
  });

  it("caps the number of answers per call from config/agent.yaml", async () => {
    const a = await applicantAt("questionnaire");
    const cap = a.deps.agent.tools.save_answers.max_fields_per_call;
    const many = Object.fromEntries(Object.entries(agentAnswers).slice(0, cap + 1));
    expect(Object.keys(many).length).toBeGreaterThan(cap);
    const r = await call(ctxFor(a), "save_answers", { answers: many });
    expect(r).toMatchObject({ ok: false, error: { code: "denied" } });
    expect(a.deps.db.select().from(intakeDrafts).all()).toEqual([]);
  });
});

describe("request_secure_step gating", () => {
  it("only links to a step the applicant can open", async () => {
    const a = await applicantAt("identity");
    expect(await call(ctxFor(a), "request_secure_step", { step: "identity" })).toMatchObject({ ok: true, output: { url: "/apply/identity?via=assistant" } });
    expect(await call(ctxFor(a), "request_secure_step", { step: "review" })).toEqual({ ok: false, error: { code: "denied", message: "Please complete the earlier steps first." } });
  });

  it("links the review to the pre-filled questionnaire page once it is open", async () => {
    const a = await applicantAt("questionnaire");
    const r = await call(ctxFor(a, "mcp", { id: "client-1", name: "Sample client" }), "request_secure_step", { step: "review" });
    expect(r).toMatchObject({ ok: true, output: { url: "/apply/questionnaire?review=1" } });
    const audit = a.deps.db.select().from(auditLog).where(eq(auditLog.action, "agent.secure_step_requested")).all();
    expect(audit.at(-1)?.payload).toEqual({ step: "review", channel: "mcp", clientId: "client-1" });
  });
});
