import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, intakeDrafts } from "@/db/schema";
import { draftsFor } from "@/agent/drafts";
import { saveQuestionnaire, type QuestionnaireData } from "@/portal/cases";
import { questionnaire } from "../portal/helpers";
import { agentAnswers, applicantAt, call, ctxFor } from "./helpers";

// Spec 10 section 6: drafts, the review page, and provenance on the confirmed answers.

const client = { id: "client-1", name: "Sample client" };

describe("drafts", () => {
  it("saves accepted answers as drafts, one row per field, and never writes the questionnaire itself", async () => {
    const a = await applicantAt("questionnaire");
    await call(ctxFor(a, "mcp", client), "save_answers", { answers: { phone: "+30 690 000 0000", pep: "no" } });
    await call(ctxFor(a, "mcp", client), "save_answers", { answers: { phone: "+30 690 000 0001" } });
    const rows = a.deps.db.select().from(intakeDrafts).all();
    expect(rows.map((r) => [r.field, r.value, r.source, r.clientId, r.clientName]).sort()).toEqual([
      ["pep", false, "mcp", "client-1", "Sample client"],
      ["phone", "+306900000001", "mcp", "client-1", "Sample client"],
    ]);
    expect(a.current().questionnaire).toBeNull();
  });

  it("asks the next questions in form order, capped by config, skipping answered and hidden ones", async () => {
    const a = await applicantAt("questionnaire");
    const max = a.deps.agent.tools.get_next_questions.max_questions;
    const first = await call(ctxFor(a), "get_next_questions", {});
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) return;
    const q = first.output as { questions: { id: string; type: string; options?: unknown[] }[]; remaining: number };
    expect(q.questions.map((x) => x.id)).toEqual(["dateOfBirth", "nationality", "preferredLanguage"].slice(0, max));
    expect(q.questions.find((x) => x.id === "nationality")).toMatchObject({ type: "country" });
    expect(q.questions.find((x) => x.id === "nationality")?.options).toBeUndefined();
    expect(JSON.stringify(q)).not.toMatch(/declaration|tinMissingReason|occupationDetail/);

    await call(ctxFor(a), "save_answers", { answers: { dateOfBirth: "1990-05-01", nationality: "GR", preferredLanguage: "en" } });
    const next = await call(ctxFor(a), "get_next_questions", { limit: 1 });
    expect(next).toMatchObject({ ok: true, output: { questions: [{ id: "phone", type: "tel" }] } });
  });

  it("shows the conditional questions only when the answer calls for them", async () => {
    const a = await applicantAt("questionnaire");
    const ids = async () => {
      const all: string[] = [];
      const r = await call(ctxFor(a), "get_next_questions", { limit: a.deps.agent.tools.get_next_questions.max_questions });
      if (r.ok) all.push(...(r.output as { questions: { id: string }[] }).questions.map((x) => x.id));
      return all;
    };
    const { tin: _tin, occupation_industry: _ind, ...rest } = agentAnswers;
    await call(ctxFor(a), "save_answers", { answers: Object.fromEntries(Object.entries(rest).slice(0, a.deps.agent.tools.save_answers.max_fields_per_call)) });
    await call(ctxFor(a), "save_answers", { answers: Object.fromEntries(Object.entries(rest).slice(a.deps.agent.tools.save_answers.max_fields_per_call)) });
    expect(await ids()).toEqual(["tin", "occupation_industry"]);
    await call(ctxFor(a), "save_answers", { answers: { tin: "", occupation_industry: "other" } });
    expect(await ids()).toEqual(["tinMissingReason", "occupationDetail"]);
  });

  it("reads saved answers back with labels and sources, and lists what is still missing", async () => {
    const a = await applicantAt("questionnaire");
    await call(ctxFor(a, "mcp", client), "save_answers", { answers: { pep: "yes", deposit_12m: "lt_20k", nationality: "GR" } });
    const r = await call(ctxFor(a), "get_review_summary", {});
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const out = r.output as { items: { id: string; value: string; source: string }[]; missing: string[] };
    expect(out.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "pep", value: "Yes", source: "mcp" }),
        expect.objectContaining({ id: "deposit_12m", value: "Less than $20,000", source: "mcp" }),
        expect.objectContaining({ id: "nationality", value: "Greece", source: "mcp" }),
      ]),
    );
    expect(out.missing).toContain("phone");
    expect(out.missing).not.toContain("declaration");
  });
});

describe("review page and provenance (spec 10 section 6 steps 2 to 4)", () => {
  it("keeps the draft source for unchanged answers, marks edited ones form, and clears the drafts (O-89)", async () => {
    const a = await applicantAt("questionnaire");
    const max = a.deps.agent.tools.save_answers.max_fields_per_call;
    const entries = Object.entries(agentAnswers);
    await call(ctxFor(a, "mcp", client), "save_answers", { answers: Object.fromEntries(entries.slice(0, max)) });
    await call(ctxFor(a, "mcp", client), "save_answers", { answers: Object.fromEntries(entries.slice(max)) });
    expect(Object.keys(draftsFor(a.deps, a.current().id, "questionnaire")).length).toBe(entries.length);

    // The person checks every answer, edits one, ticks the declaration and continues.
    saveQuestionnaire(a.deps, a.current(), { ...questionnaire, phone: "+30 690 000 9999" });

    const q = a.current().questionnaire as QuestionnaireData;
    expect(q.provenance?.phone).toEqual({ source: "form" });
    expect(q.provenance?.pep).toMatchObject({ source: "mcp", clientId: "client-1", clientName: "Sample client", confirmedAt: expect.any(String) });
    expect(q.provenance?.declaration).toEqual({ source: "form" });
    expect(Object.keys(draftsFor(a.deps, a.current().id, "questionnaire"))).toEqual([]);

    const confirmed = a.deps.db.select().from(auditLog).where(eq(auditLog.action, "answers.confirmed")).all();
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.payload).toMatchObject({ sources: ["mcp"], unchanged: entries.length - 1, edited: 1 });
    expect(JSON.stringify(confirmed[0]!.payload)).not.toMatch(/9999|SAMPLE-TIN|1990-05-01/);
  });

  it("stores no provenance when the person used the form alone (the form route is unchanged)", async () => {
    const a = await applicantAt("questionnaire");
    saveQuestionnaire(a.deps, a.current(), questionnaire);
    expect((a.current().questionnaire as QuestionnaireData).provenance).toBeUndefined();
    expect(a.deps.db.select().from(auditLog).where(eq(auditLog.action, "answers.confirmed")).all()).toEqual([]);
  });

  it("audits tool calls with field ids and an argument hash, never the values", async () => {
    const a = await applicantAt("questionnaire");
    await call(ctxFor(a, "mcp", client), "save_answers", { answers: { phone: "+30 690 000 0000", tin: "SAMPLE-TIN-1" } });
    const calls = a.deps.db.select().from(auditLog).where(eq(auditLog.action, "agent.tool_called")).all();
    expect(calls.at(-1)?.payload).toMatchObject({ tool: "save_answers", channel: "mcp", clientId: "client-1", clientName: "Sample client", argsHash: expect.stringMatching(/^[0-9a-f]{64}$/), outcome: "ok" });
    expect(JSON.stringify(a.deps.db.select().from(auditLog).all().map((x) => x.payload))).not.toMatch(/690|SAMPLE-TIN/);
  });
});
