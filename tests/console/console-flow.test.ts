import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, screeningHits } from "@/db/schema";
import { decide, recalculateEddForCase, requestEdd, startReview, triageHit } from "@/console/actions";
import { loadCaseView } from "@/console/case-view";
import { getMode, setMode } from "@/console/mode";
import { listQueue } from "@/console/queue";
import { createAccount, getSessionApplicant, verifyOtp } from "@/portal/accounts";
import { getCurrentCase, markOverviewSeen, saveIdentity, saveQuestionnaire, saveResidence, submitCase } from "@/portal/cases";
import { applicantView } from "@/portal/decision";
import { submitEdd } from "@/portal/edd";
import { file, identityFields, makeDeps, questionnaire, residenceFields } from "../portal/helpers";

type Persona = { first: string; last: string; email: string; dob?: string; country?: string; answers?: Partial<typeof questionnaire> };

async function submitted(t: ReturnType<typeof makeDeps>, p: Persona) {
  await createAccount(t.deps, { persona: "individual", firstName: p.first, lastName: p.last, email: p.email });
  const { sessionToken } = verifyOtp(t.deps, p.email, { code: t.lastCode() });
  const applicant = getSessionApplicant(t.deps, sessionToken)!;
  const current = () => getCurrentCase(t.deps, applicant.id);
  markOverviewSeen(t.deps, current());
  await saveIdentity(t.deps, current(), identityFields, { front: file("poi.png"), selfie: file("selfie.png") });
  await saveResidence(t.deps, current(), { ...residenceFields, country: p.country ?? "GR" }, { por: file("por.png") });
  saveQuestionnaire(t.deps, current(), { ...questionnaire, dateOfBirth: p.dob ?? questionnaire.dateOfBirth, ...p.answers });
  await submitCase(t.deps, current());
  return current;
}
const actions = (t: ReturnType<typeof makeDeps>) => t.deps.db.select().from(auditLog).all().map((a) => a.action);

describe("analyst console flows", () => {
  it("clean case with a false-positive sanctions hit: triage, then approve; applicant sees the threshold", async () => {
    const t = makeDeps();
    const current = await submitted(t, { first: "Ada", last: "Sample", email: "ada@example.test" });
    const id = current().id;
    expect(loadCaseView(t.deps, id).actions.approve.allowed).toBe(false);

    startReview(t.deps, id, "analyst-1");
    const [hit] = loadCaseView(t.deps, id).hits;
    expect(hit).toMatchObject({ entryId: "WL-001", status: "open" });
    expect(() => decide(t.deps, id, "approve", "ok", "analyst-1")).toThrow(/open screening hit/);

    triageHit(t.deps, id, hit!.id, "false_positive", "Different DOB and country", "analyst-1");
    decide(t.deps, id, "approve", "Documents consistent, hit cleared", "analyst-1");
    expect(applicantView(current())).toEqual({ kind: "confirmation", threshold: 19999 });
    expect(actions(t)).toEqual(expect.arrayContaining(["screening.completed", "case.review_started", "screening.triaged", "case.decided"]));
  });

  it("confirmed PEP match re-scores to High, forces EDD, and EDD raises the threshold beyond the initial ceiling", async () => {
    const t = makeDeps();
    const current = await submitted(t, { first: "Petros", last: "Demopoulos", email: "petros@example.test", dob: "1971-08-30" });
    const id = current().id;
    startReview(t.deps, id, "analyst-1");
    const [hit] = loadCaseView(t.deps, id).hits;
    triageHit(t.deps, id, hit!.id, "true_match", "Exact name and DOB", "analyst-1");

    expect(current().riskResult).toMatchObject({ band: "high", forced_by: "pep", edd_required: true });
    expect(actions(t)).toContain("engine.rescored");
    expect(loadCaseView(t.deps, id).actions.approve).toMatchObject({ allowed: false, why: expect.stringMatching(/EDD/) });

    requestEdd(t.deps, id, "PEP: source of funds needed", "analyst-1");
    expect(applicantView(current())).toEqual({ kind: "edd", extraKyc: "already_satisfied" });
    await expect(submitEdd(t.deps, current(), {}, { sof: [] })).rejects.toMatchObject({ fieldErrors: { sof: [expect.any(String)] } });
    await submitEdd(t.deps, current(), { note: "Tax report attached" }, { sof: [file("tax-report.pdf", "application/pdf"), file("payslip.png")] });
    expect(current().status).toBe("edd_submitted");
    expect(loadCaseView(t.deps, id).docs.filter((d) => d.kind === "sof")).toHaveLength(2);

    // spec 05 doc example: $200k salary documented, $100k deposited -> $160k, $60k headroom
    expect(recalculateEddForCase(t.deps, id, { documentedAnnualAmount: 200000, depositedToDate: 100000 }, "analyst-1")).toEqual({ outcome: "new_threshold", new_threshold: 160000, headroom: 60000 });
    decide(t.deps, id, "approve", "SoF evidenced", "analyst-1");
    expect(applicantView(current())).toEqual({ kind: "confirmation", threshold: 160000 });
  });

  it("EDD without source of funds: approval blocked, rejection records the return-of-funds instruction", async () => {
    const t = makeDeps();
    const current = await submitted(t, { first: "Bo", last: "Tester", email: "bo@example.test", answers: { pep: "yes" } });
    const id = current().id;
    startReview(t.deps, id, "analyst-2");
    requestEdd(t.deps, id, "PEP declared", "analyst-2");
    await submitEdd(t.deps, current(), {}, { sof: [file("letter.png")] });
    recalculateEddForCase(t.deps, id, { documentedAnnualAmount: null, depositedToDate: 15000 }, "analyst-2");
    expect(loadCaseView(t.deps, id).actions.approve.allowed).toBe(false);

    decide(t.deps, id, "reject", "No source of funds provided", "analyst-2");
    const instruction = t.deps.db.select().from(auditLog).where(eq(auditLog.action, "funds.return_instruction")).get();
    expect(instruction?.payload).toMatchObject({ outcome: "return_all_and_terminate", amount: 15000, report_to: ["aml", "compliance"] });
    expect(applicantView(current())).toEqual({ kind: "no_go" });
  });

  it("engine hard rule (prohibited country): the analyst can only reject", async () => {
    const t = makeDeps();
    const current = await submitted(t, { first: "Bo", last: "Tester", email: "ir@example.test", country: "IR" });
    const id = current().id;
    startReview(t.deps, id, "analyst-1");
    expect(() => decide(t.deps, id, "approve", "x", "analyst-1")).toThrow(/hard rule/);
    expect(() => requestEdd(t.deps, id, "x", "analyst-1")).toThrow();
    decide(t.deps, id, "reject", "Prohibited jurisdiction confirmed", "analyst-1");
    expect(current().status).toBe("rejected");
  });

  it("a confirmed sanctions match blocks approval", async () => {
    const t = makeDeps();
    const current = await submitted(t, { first: "Ada", last: "Sample", email: "ada2@example.test" });
    const id = current().id;
    startReview(t.deps, id, "analyst-1");
    const hitId = t.deps.db.select().from(screeningHits).where(eq(screeningHits.caseId, id)).get()!.id;
    triageHit(t.deps, id, hitId, "true_match", "Analyst judgement", "analyst-1");
    expect(loadCaseView(t.deps, id).actions.approve).toMatchObject({ allowed: false, why: "Confirmed sanctions match." });
  });

  it("every triage and decision needs a reason", async () => {
    const t = makeDeps();
    const current = await submitted(t, { first: "Ada", last: "Sample", email: "ada3@example.test" });
    const id = current().id;
    startReview(t.deps, id, "analyst-1");
    const hitId = loadCaseView(t.deps, id).hits[0]!.id;
    expect(() => triageHit(t.deps, id, hitId, "false_positive", " ", "analyst-1")).toThrow(/reason/);
    expect(() => decide(t.deps, id, "reject", "", "analyst-1")).toThrow(/reason/);
  });
});

describe("mode and queue", () => {
  it("defaults to the configured mode and audits changes", () => {
    const t = makeDeps();
    expect(getMode(t.deps)).toBe(t.deps.consoleConfig.default_mode);
    setMode(t.deps, "mvp2", "analyst-1");
    expect(getMode(t.deps)).toBe("mvp2");
    expect(t.deps.db.select().from(auditLog).where(eq(auditLog.action, "mode.changed")).get()?.payload).toEqual({ from: "mvp1", to: "mvp2" });
  });

  it("lists submitted cases oldest first and filters by band, status and age", async () => {
    const t = makeDeps();
    await submitted(t, { first: "Ada", last: "Sample", email: "q1@example.test" });
    t.advance(2 * 86_400_000);
    await submitted(t, { first: "Bo", last: "Tester", email: "q2@example.test", country: "KE" });
    const all = listQueue(t.deps);
    expect(all.map((r) => [r.applicant, r.band, r.route, r.openHits, r.ageDays])).toEqual([
      ["Ada Sample", "low", "standard", 1, 2],
      ["Bo Tester", "auto_high", "edd_required", 0, 0],
    ]);
    expect(listQueue(t.deps, { band: "auto_high" })).toHaveLength(1);
    expect(listQueue(t.deps, { olderThanDays: 1 }).map((r) => r.applicant)).toEqual(["Ada Sample"]);
    expect(listQueue(t.deps, { status: "approved" })).toEqual([]);
  });
});
