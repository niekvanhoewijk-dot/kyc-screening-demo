import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, decisionRecords, screeningHits } from "@/db/schema";
import { decide, recalculateEddForCase, requestEdd, startReview, triageHit } from "@/console/actions";
import { replayRecord, verifyChain } from "@/engine";
import { createAccount, getSessionApplicant, verifyOtp } from "@/portal/accounts";
import { getCurrentCase, markOverviewSeen, saveIdentity, saveQuestionnaire, saveResidence, submitCase } from "@/portal/cases";
import { submitEdd } from "@/portal/edd";
import { allRecords, recordsFor } from "@/records/store";
import { file, identityFields, makeDeps, questionnaire, residenceFields } from "../portal/helpers";

type T = ReturnType<typeof makeDeps>;

async function submitted(t: T, p: { first: string; last: string; email: string; dob?: string; country?: string; answers?: Partial<typeof questionnaire> }) {
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

/** A busy day in the console: PEP confirmed -> rescore -> EDD -> recalculation -> approve; a rejection; a US tax resident. */
async function busyDay() {
  const t = makeDeps();
  const petros = await submitted(t, { first: "Petros", last: "Demopoulos", email: "petros@example.test", dob: "1971-08-30" });
  const id = petros().id;
  startReview(t.deps, id, "analyst-1");
  const hit = t.deps.db.select().from(screeningHits).where(eq(screeningHits.caseId, id)).get()!;
  triageHit(t.deps, id, hit.id, "true_match", "Exact match", "analyst-1");
  requestEdd(t.deps, id, "PEP: source of funds", "analyst-1");
  await submitEdd(t.deps, petros(), {}, { sof: [file("tax.png")] });
  recalculateEddForCase(t.deps, id, { documentedAnnualAmount: 200000, depositedToDate: 100000 }, "analyst-1");
  decide(t.deps, id, "approve", "SoF evidenced", "analyst-1");

  const sam = await submitted(t, { first: "Sam", last: "Nemune", email: "sam@example.test", country: "IR" });
  startReview(t.deps, sam().id, "analyst-2");
  decide(t.deps, sam().id, "reject", "Prohibited jurisdiction", "analyst-2");
  await submitted(t, { first: "Uma", last: "Taxpayer", email: "us@example.test", answers: { usTaxResident: "yes" } });
  return { t, petrosId: id };
}

describe("decision records (spec 08 section 4.4)", () => {
  it("(1) replay: every record reproduces its outcome and reason codes under its pinned policy", async () => {
    const { t } = await busyDay();
    const records = allRecords(t.deps);
    expect(records.length).toBe(11); // Petros 7, Sam 3, the US tax resident 1
    for (const r of records) expect({ seq: r.seq, kind: r.kind, result: replayRecord(r, t.deps.policies, t.deps.kyb) }).toEqual({ seq: r.seq, kind: r.kind, result: { reproduced: true } });
  });

  it("records the engine's reasons, never names or document content", async () => {
    const { t, petrosId } = await busyDay();
    const recs = recordsFor(t.deps, petrosId);
    expect(recs.map((r) => r.kind)).toEqual(["engine.score", "analyst.start_review", "engine.rescore", "analyst.edd", "applicant.edd_submitted", "engine.edd", "analyst.approve"]);
    expect(recs[2]).toMatchObject({ outcome: { band: "high", forced_by: "pep", edd_required: true }, reason_codes: expect.arrayContaining(["RC_PEP_FORCES_HIGH", "RC_BAND_EDD_REQUIRED"]) });
    expect(recs[5]).toMatchObject({ outcome: { edd_outcome: "new_threshold", threshold: 160000 }, reason_codes: ["RC_EDD_NEW_THRESHOLD"] });
    expect(recs[6]).toMatchObject({ decided_by: "analyst:analyst-1", analyst_reason: "SoF evidenced", outcome: { status_from: "edd_submitted", status_to: "approved" } });
    const text = JSON.stringify(recs);
    for (const leak of ["Petros", "Demopoulos", "petros@example.test", "1971-08-30", "SAMPLE", "poi.png"]) expect(text).not.toContain(leak);
  });

  it("(2) hash chain: intact chains verify; altering any stored field breaks verification", async () => {
    const { t, petrosId } = await busyDay();
    expect(verifyChain(recordsFor(t.deps, petrosId))).toEqual([]);

    // Edit the outcome of the rescore record in the database.
    const rows = t.deps.db.select().from(decisionRecords).where(eq(decisionRecords.subject, petrosId)).all().sort((a, b) => a.seq - b.seq);
    const target = rows[2]!;
    const forged = { ...(target.record as Record<string, unknown>), outcome: { ...(target.record as { outcome: object }).outcome, band: "low" } };
    t.deps.db.update(decisionRecords).set({ record: forged }).where(eq(decisionRecords.id, target.id)).run();
    expect(verifyChain(recordsFor(t.deps, petrosId))).toContainEqual(expect.objectContaining({ seq: 3, problem: expect.stringMatching(/hash/) }));
  });

  it("(2b) re-sealing a forged record still breaks the link to the next one", async () => {
    const { t, petrosId } = await busyDay();
    const { recordHash } = await import("@/engine");
    const recs = recordsFor(t.deps, petrosId);
    const forgedBody = { ...recs[2]!, outcome: { ...recs[2]!.outcome, band: "low" } } as Record<string, unknown>;
    delete forgedBody.hash;
    const forged = { ...forgedBody, hash: recordHash(forgedBody as never) };
    const problems = verifyChain(recs.map((r, i) => (i === 2 ? (forged as typeof r) : r)));
    expect(problems).toContainEqual(expect.objectContaining({ seq: 4, problem: expect.stringMatching(/prev_hash/) }));
  });

  it("(3) coverage: every state change in the audit trail has a decision record", async () => {
    const { t } = await busyDay();
    const STATE_CHANGES: Record<string, string[]> = {
      "case.submitted": ["engine.score"],
      "case.review_started": ["analyst.start_review"],
      "engine.rescored": ["engine.rescore"],
      "engine.edd_recalculated": ["engine.edd"],
      "edd.submitted": ["applicant.edd_submitted"],
      "case.decided": ["analyst.approve", "analyst.reject", "analyst.edd"],
    };
    const audits = t.deps.db.select().from(auditLog).all().filter((a) => a.action in STATE_CHANGES);
    const records = allRecords(t.deps);
    for (const [action, kinds] of Object.entries(STATE_CHANGES)) {
      const perCase = (subject: string) => [audits.filter((a) => a.action === action && a.entity === `case:${subject}`).length, records.filter((r) => r.subject === subject && kinds.includes(r.kind)).length];
      for (const subject of new Set(records.map((r) => r.subject))) {
        const [audited, recorded] = perCase(subject);
        expect({ action, audited }).toEqual({ action, audited: recorded });
      }
    }
  });

  it("(4) policy is pinned: a June record stays on P1 and replays after P2 is in force", async () => {
    const t = makeDeps("2026-10-18T10:00:00Z");
    const before = await submitted(t, { first: "Bo", last: "Bulgaria", email: "bg1@example.test", country: "BG" });
    t.clock.now = new Date("2026-11-04T10:00:00Z");
    const after = await submitted(t, { first: "Bo", last: "Bulgaria", email: "bg2@example.test", country: "BG" });

    const [r1] = recordsFor(t.deps, before().id);
    const [r2] = recordsFor(t.deps, after().id);
    expect(r1).toMatchObject({ policy: { id: "P1" }, outcome: { band: "auto_high" }, reason_codes: expect.arrayContaining(["RC_COUNTRY_INCREASED_MONITORING"]) });
    expect(r2).toMatchObject({ policy: { id: "P2" }, outcome: { band: "low", total: 9 }, reason_codes: expect.arrayContaining(["RC_COUNTRY_RECENTLY_DELISTED"]) });
    expect(replayRecord(r1!, t.deps.policies, t.deps.kyb)).toEqual({ reproduced: true });
    expect(before().riskResult).toMatchObject({ band: "auto_high" }); // the stored case is not re-scored by a newer policy
  });
});
