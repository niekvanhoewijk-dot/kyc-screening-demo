import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, cases, decisionRecords, policyDrafts, settings, simCustomers } from "@/db/schema";
import { checkRulesFromConfig } from "@/documents/factory";
import type { PreReviewDeps } from "@/documents/pre-review";
import { resetDemo, wipeDemoData } from "@/demo/seed";
import { diffUnderPolicy, replayRecord, verifyChain, type DecisionRecord } from "@/engine";
import { createAccount, getSessionApplicant, verifyOtp } from "@/portal/accounts";
import { getCurrentCase, markOverviewSeen, saveIdentity, saveQuestionnaire, saveResidence, submitCase } from "@/portal/cases";
import { PortalError } from "@/portal/errors";
import { allRecords, recordsFor } from "@/records/store";
import { bookCustomer, bookFixture } from "@/simulator/book";
import { simClock } from "@/simulator/clock";
import { effectivePolicy, policySet } from "@/simulator/policies";
import { advanceClock, applyPolicy, dryRun, injectEvent, moveClock, portfolio, PORTFOLIO_SUBJECT, resetClock, simulatorView } from "@/simulator/service";
import { file, identityFields, makeDeps, questionnaire, residenceFields } from "../portal/helpers";

// Phase 8c (docs/spec/08 sections 5.1, 5.4, 5.5). Wall clock = the demo date; the simulated clock moves separately.
const WALL = "2026-11-04T10:00:00Z";
const MYANMAR_FOLLOW_FATF = { base: "P2", settings: { call_for_action_treatment: "follow_fatf" as const } };
const DELISTED_HELD = { base: "P2", settings: { recently_delisted_treatment: "hold_auto_high" as const } };

async function seeded() {
  const t = makeDeps(WALL);
  const d: PreReviewDeps = {
    ...t.deps,
    checkRules: checkRulesFromConfig(),
    documentReader: () => {
      throw new Error("Claude is not used by the simulator");
    },
  };
  await resetDemo(d, { claude: "skip", actor: "cli" });
  return { t, d };
}

async function applicant(t: ReturnType<typeof makeDeps>, email: string, country: string, expiryDate = identityFields.expiryDate) {
  await createAccount(t.deps, { persona: "individual", firstName: "Bo", lastName: "Sample", email });
  const { sessionToken } = verifyOtp(t.deps, email, { code: t.lastCode() });
  const a = getSessionApplicant(t.deps, sessionToken)!;
  const current = () => getCurrentCase(t.deps, a.id);
  markOverviewSeen(t.deps, current());
  await saveIdentity(t.deps, current(), { ...identityFields, expiryDate }, { front: file("poi.png"), selfie: file("selfie.png") });
  await saveResidence(t.deps, current(), { ...residenceFields, country }, { por: file("por.png") });
  saveQuestionnaire(t.deps, current(), questionnaire);
  await submitCase(t.deps, current());
  return { sessionToken, caseId: current().id };
}

const count = (d: PreReviewDeps) => d.db.select().from(decisionRecords).all().length;
const audits = (d: PreReviewDeps, action: string) => d.db.select().from(auditLog).where(eq(auditLog.action, action)).all();

function allReplay(d: PreReviewDeps) {
  const records = allRecords(d);
  const policies = policySet(d);
  const bySubject = new Map<string, DecisionRecord[]>();
  for (const r of records) bySubject.set(r.subject, [...(bySubject.get(r.subject) ?? []), r]);
  for (const recs of bySubject.values()) expect(verifyChain(recs)).toEqual([]);
  for (const r of records) expect({ subject: r.subject, kind: r.kind, result: replayRecord(r, policies, d.kyb) }).toEqual({ subject: r.subject, kind: r.kind, result: { reproduced: true } });
  return records;
}

describe("simulated clock (spec 08 5.1)", () => {
  it("starts on the wall-clock date, moves, and resets, each move audited", async () => {
    const { d } = await seeded();
    expect(simClock(d)).toEqual({ date: "2026-11-04", simulated: false });
    expect(advanceClock(d, { days: 14 }, "analyst-1").clock).toEqual({ date: "2026-11-18", simulated: true });
    expect(advanceClock(d, { months: 1 }, "analyst-1").clock.date).toBe("2026-12-18");
    expect(() => moveClock(d, "18-12-2026", "analyst-1")).toThrow(PortalError);
    expect(resetClock(d, "analyst-1").clock).toEqual({ date: "2026-11-04", simulated: false });
    expect(audits(d, "sim.clock_set").map((a) => a.actor)).toEqual(["analyst:analyst-1", "analyst:analyst-1"]);
    expect(audits(d, "sim.clock_reset")).toHaveLength(1);
  });

  it("OTP, sessions, intake checks and scoring of new applicants keep the wall clock (O-46)", async () => {
    const { t, d } = await seeded();
    moveClock(d, "2032-01-01", "analyst-1");
    // On the simulated date the OTP would have expired, the session too, and a passport expiring in 2031 would be refused.
    const { sessionToken, caseId } = await applicant(t, "wall.clock@example.test", "GR", "2031-03-14");
    expect(getSessionApplicant(t.deps, sessionToken)).not.toBeNull();
    const [score] = recordsFor(d, caseId);
    expect(score).toMatchObject({ kind: "engine.score", at_sim: null, at_wall: WALL.replace("Z", ".000Z"), policy: { id: "P2" } });
  });

  it("is read only by the simulator: no other module imports the clock or the setting key", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f.name) && !p.includes(`${path.sep}simulator`)) {
          const src = fs.readFileSync(p, "utf8");
          if (src.includes("simulator/clock") || src.includes('"sim.now"')) offenders.push(p);
        }
      }
    };
    walk(path.resolve("src"));
    expect(offenders).toEqual([]);
  });
});

describe("portfolio and view", () => {
  it("is the synthetic book plus the seeded cases, each with its latest scored inputs", async () => {
    const { d } = await seeded();
    const p = portfolio(d);
    expect(p.filter((s) => s.source === "book")).toHaveLength(bookFixture().customers.length);
    expect(p.filter((s) => s.source === "case")).toHaveLength(d.db.select().from(cases).all().length);
  });

  it("shows the S1 changes for the book without writing anything", async () => {
    const { d } = await seeded();
    const before = count(d);
    const view = simulatorView(d, { baseline: "P1", candidate: "P2" });
    const book = diffUnderPolicy(bookFixture().customers, d.policies.byId("P1"), d.policies.byId("P2"));
    for (const row of book.rows) expect(view.diff.rows.find((r) => r.subject === row.subject)).toEqual(row);
    expect(view.diff.rows.filter((r) => r.changed.length).map((r) => r.subject)).toEqual(["BK-01", "BK-02", "BK-03", "BK-04"]);
    expect(view.obligations.map((o) => [o.subject, o.code, o.flag])).toEqual([
      ["BK-13", "LC_REVIEW_DUE_EDD_ANNUAL", "preview"],
      ["BK-15", "LC_POR_EXPIRY_NOTICE", "in_force"],
    ]);
    expect(simulatorView(d, { candidate: MYANMAR_FOLLOW_FATF }).candidate.id).toMatch(/^P2-draft-/);
    expect(count(d)).toBe(before);
    expect(d.db.select().from(policyDrafts).all()).toEqual([]);
  });
});

describe("policy change (spec 08 5.5)", () => {
  it("dry run writes only a policy.dry_run summary record", async () => {
    const { d } = await seeded();
    const casesBefore = d.db.select().from(cases).all();
    const before = count(d);
    const { record, diff } = dryRun(d, { baseline: "P1", candidate: "P2" }, "analyst-1");
    expect(count(d)).toBe(before + 1);
    expect(record).toMatchObject({ subject: PORTFOLIO_SUBJECT, kind: "policy.dry_run", policy: { id: "P2" }, decided_by: "analyst:analyst-1", at_sim: "2026-11-04" });
    expect(record.outcome.summary).toEqual(diff.summary);
    expect(record.outcome.changes?.map((c) => c.subject)).toEqual(["BK-01", "BK-02", "BK-03", "BK-04"]);
    expect(d.db.select().from(cases).all()).toEqual(casesBefore);
    expect(d.db.select().from(simCustomers).all()).toEqual([]);
    expect(effectivePolicy(d).policy.id).toBe("P2");
    expect(audits(d, "sim.dry_run")).toHaveLength(1);
    allReplay(d);
  });

  it("apply re-scores the changed subjects under the candidate and needs a reason", async () => {
    const { d } = await seeded();
    expect(() => applyPolicy(d, { candidate: MYANMAR_FOLLOW_FATF }, "  ", "analyst-1")).toThrow(PortalError);
    const r = applyPolicy(d, { candidate: MYANMAR_FOLLOW_FATF }, "Compare FATF reading for Myanmar", "analyst-1");
    expect(r.rescored).toBe(2);
    const draftId = r.record.policy.id;
    expect(draftId).toMatch(/^P2-draft-/);
    for (const id of ["BK-07", "BK-08"])
      expect(recordsFor(d, id).find((x) => x.kind === "engine.rescore")).toMatchObject({
        policy: { id: draftId },
        inputs: { context: "policy_change" },
        outcome: { band: "auto_high", route: "edd_required", threshold: 40000 },
        reason_codes: ["RC_COUNTRY_CALL_FOR_ACTION_EDD", "RC_BAND_EDD_REQUIRED", "RC_THRESHOLD_CATEGORY_CAP"],
      });
    expect(r.record).toMatchObject({ kind: "policy.applied", analyst_reason: "Compare FATF reading for Myanmar" });
    expect(effectivePolicy(d).policy.id).toBe(draftId);
    expect(d.db.select().from(policyDrafts).all().map((x) => x.id)).toEqual([draftId]);
    allReplay(d);
  });

  it("never rejects an existing customer: a move into Prohibited goes to analyst review (D13)", async () => {
    const { d } = await seeded();
    applyPolicy(d, { candidate: MYANMAR_FOLLOW_FATF }, "Compare", "analyst-1");
    const back = applyPolicy(d, { candidate: "P2" }, "Back to Full v3", "analyst-1");
    expect(back.record.outcome.summary).toMatchObject({ changed: 2, analyst_review: 2 });
    expect(back.record.reason_codes).toEqual(["LC_POLICY_CHANGE_REVIEW"]);
    const last = recordsFor(d, "BK-07").filter((x) => x.kind === "engine.rescore").at(-1)!;
    expect(last.outcome).toMatchObject({ band: "prohibited", route: "analyst_review" });
    expect(last.reason_codes).toContain("LC_POLICY_CHANGE_REVIEW");
    expect(allRecords(d).some((x) => x.kind === "engine.rescore" && x.outcome.route === "reject")).toBe(false);
    allReplay(d);
  });

  it("re-scores a seeded case on the case itself when the candidate changes it", async () => {
    const { t, d } = await seeded();
    const { caseId } = await applicant(t, "bg.applicant@example.test", "BG");
    expect((d.db.select().from(cases).where(eq(cases.id, caseId)).get()!.riskResult as { band: string }).band).toBe("low");
    const r = applyPolicy(d, { candidate: DELISTED_HELD }, "Hold delisted countries", "analyst-1");
    expect(r.diff.rows.filter((x) => x.changed.length).map((x) => x.subject)).toEqual(["BK-01", "BK-02", "BK-03", "BK-04", caseId]);
    const c = d.db.select().from(cases).where(eq(cases.id, caseId)).get()!;
    expect((c.riskResult as { band: string }).band).toBe("auto_high");
    expect((c.engineVersions as { policy_id: string }).policy_id).toBe(r.record.policy.id);
    expect(c.status).toBe("submitted");
    allReplay(d);
  });
});

describe("events and lifecycle records (spec 08 5.4)", () => {
  it("S5: a deposit reaching the threshold records LC_THRESHOLD_REACHED once; EDD sets a new threshold", async () => {
    const { d } = await seeded();
    injectEvent(d, "BK-16", { type: "deposit", amount: 700 }, "analyst-1");
    const reached = recordsFor(d, "BK-16").filter((r) => r.kind === "lifecycle.threshold_reached");
    expect(reached).toHaveLength(1);
    expect(reached[0]).toMatchObject({ outcome: { status_to: "edd_requested", route: "edd" }, reason_codes: ["LC_THRESHOLD_REACHED"], at_sim: "2026-11-04" });
    expect(reached[0]!.inputs).not.toHaveProperty("customer.note");
    advanceClock(d, { days: 1 }, "analyst-1");
    expect(recordsFor(d, "BK-16").filter((r) => r.kind === "lifecycle.threshold_reached")).toHaveLength(1);
    const edd = injectEvent(d, "BK-16", { type: "edd_outcome", documented_annual_amount: 45000 }, "analyst-1");
    expect(edd.customer).toMatchObject({ threshold: 36000, deposited_to_date: 20100 });
    expect(edd.obligations).toEqual([]);
    expect(recordsFor(d, "BK-16").at(-1)).toMatchObject({ kind: "engine.edd", outcome: { edd_outcome: "new_threshold", threshold: 36000, amount: 15900 } });
    expect(audits(d, "sim.event_injected")).toHaveLength(2);
    allReplay(d);
  });

  it("S4: POR notice and expiry are recorded as the clock moves; a new POR clears them", async () => {
    const { d } = await seeded();
    moveClock(d, "2026-11-04", "analyst-1");
    expect(recordsFor(d, "BK-15").map((r) => r.reason_codes[0])).toEqual(["LC_POR_EXPIRY_NOTICE"]);
    moveClock(d, "2026-11-18", "analyst-1");
    expect(recordsFor(d, "BK-15").at(-1)).toMatchObject({ kind: "lifecycle.por_expired", outcome: { status_to: "expired_por", obligation: { due_on: "2026-11-18" } } });
    expect(moveClock(d, "2026-11-18", "analyst-1").recorded).toBe(0);
    const replaced = injectEvent(d, "BK-15", { type: "por_replaced", issued_at: "2026-11-18" }, "analyst-1");
    expect(replaced.obligations).toEqual([]);
    expect(bookCustomer(d, "BK-15")!.por_expires_at).toBe("2027-05-18");
    allReplay(d);
  });

  it("pep_confirmed and circumstance_change re-score; events only apply to book customers", async () => {
    const { d } = await seeded();
    injectEvent(d, "BK-11", { type: "pep_confirmed" }, "analyst-1");
    expect(recordsFor(d, "BK-11").find((r) => r.kind === "engine.rescore")).toMatchObject({ outcome: { band: "high", forced_by: "pep" } });
    injectEvent(d, "BK-12", { type: "circumstance_change", field: "country", value: "KE", at: "2026-11-04" }, "analyst-1");
    const kinds = recordsFor(d, "BK-12").map((r) => [r.kind, r.reason_codes.at(-1)]);
    expect(kinds).toContainEqual(["lifecycle.review_due", "LC_CIRCUMSTANCE_CHANGE"]);
    const caseId = d.db.select().from(cases).all()[0]!.id;
    expect(() => injectEvent(d, caseId, { type: "pep_confirmed" }, "analyst-1")).toThrow(/synthetic book/);
    expect(() => injectEvent(d, "BK-11", { type: "list_change", policy_id: "P2" }, "analyst-1")).toThrow(PortalError);
    allReplay(d);
  });
});

describe("demo reset undoes the simulator", () => {
  it("clears the clock, applied policy, drafts, changed customers and simulator records", async () => {
    const { d } = await seeded();
    moveClock(d, "2027-07-10", "analyst-1");
    injectEvent(d, "BK-16", { type: "deposit", amount: 700 }, "analyst-1");
    applyPolicy(d, { candidate: MYANMAR_FOLLOW_FATF }, "Compare", "analyst-1");
    await wipeDemoData(d);
    expect(d.db.select().from(settings).all()).toEqual([]);
    expect(d.db.select().from(policyDrafts).all()).toEqual([]);
    expect(d.db.select().from(simCustomers).all()).toEqual([]);
    expect(d.db.select().from(decisionRecords).all()).toEqual([]);
    expect(simClock(d).simulated).toBe(false);
    expect(effectivePolicy(d).policy.id).toBe("P2");
    expect(bookCustomer(d, "BK-16")!.deposited_to_date).toBe(19400);
  });
});

describe("simulator page choice (URL state)", async () => {
  const { readChoice } = await import("@/app/analyst/simulator/refs");
  const { resolvePolicy } = await import("@/simulator/policies");

  it("defaults to comparing the current book policy with itself, so nothing changes until a knob moves", async () => {
    const { d } = await seeded();
    const c = readChoice(d, () => undefined);
    expect(c).toMatchObject({ baseline: "P2", baselineParam: "", candidateBase: "P2" });
    expect(resolvePolicy(d, c.refs.candidate).policy.id).toBe("P2");
    expect(simulatorView(d, c.refs).diff.summary.changed).toBe(0);
  });

  it("after an apply, the default baseline and candidate follow the applied draft", async () => {
    const { d } = await seeded();
    const applied = applyPolicy(d, { candidate: MYANMAR_FOLLOW_FATF }, "Compare", "analyst-1").record.policy.id;
    const c = readChoice(d, () => undefined);
    expect(c.baseline).toBe(applied);
    expect(resolvePolicy(d, c.refs.candidate).policy.id).toBe(applied);
    const back = readChoice(d, (k) => ({ candidate: "P2", cfa: "all_prohibited" })[k]);
    expect(simulatorView(d, back.refs).diff.summary).toMatchObject({ changed: 2, analyst_review: 2 });
  });
});
