import { describe, expect, it } from "vitest";
import { auditLog } from "@/db/schema";
import { createAccount, getSessionApplicant, startSignIn, verifyOtp } from "@/portal/accounts";
import {
  getCurrentCase,
  markOverviewSeen,
  saveIdentity,
  saveQuestionnaire,
  saveResidence,
  stepCase,
  submitCase,
} from "@/portal/cases";
import { applicantView, recordDecision } from "@/portal/decision";
import { resumeStep } from "@/portal/steps";
import { account, file, identityFields, makeDeps, questionnaire, residenceFields } from "./helpers";

async function signedUp(email?: string) {
  const t = makeDeps();
  await createAccount(t.deps, account(email));
  const { sessionToken } = verifyOtp(t.deps, account(email).email, { code: t.lastCode() });
  const applicant = getSessionApplicant(t.deps, sessionToken)!;
  const current = () => getCurrentCase(t.deps, applicant.id);
  return { ...t, applicant, current };
}

async function completeAllSteps(t: Awaited<ReturnType<typeof signedUp>>, answers = questionnaire) {
  markOverviewSeen(t.deps, t.current());
  await saveIdentity(t.deps, t.current(), identityFields, { front: file("poi-front.png"), selfie: file("selfie.png") });
  await saveResidence(t.deps, t.current(), residenceFields, { por: file("por.pdf", "application/pdf") });
  saveQuestionnaire(t.deps, t.current(), answers);
}

describe("applicant flow 2.1.3 - 2.1.8", () => {
  it("a synthetic applicant completes the flow end to end and sees the threshold after approval", async () => {
    const t = await signedUp();
    await completeAllSteps(t);
    expect(resumeStep(stepCase(t.current()))).toBe("check");
    await submitCase(t.deps, t.current());

    const c = t.current();
    expect(c.status).toBe("submitted");
    expect(c.riskResult).toMatchObject({ total: 8, band: "low" }); // matches golden RISK-3 inputs
    expect(c.thresholdResult).toMatchObject({ threshold: 19999 }); // matches golden THR-2
    expect(applicantView(c)).toEqual({ kind: "check" });

    recordDecision(t.deps, c.id, "approve", "Documents and answers consistent", "dev");
    expect(applicantView(t.current())).toEqual({ kind: "confirmation", threshold: 19999 });

    const actions = t.deps.db.select().from(auditLog).all().map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["account.created", "email.verified", "document.uploaded", "face_match.result", "case.submitted", "engine.scored", "case.decided"]));
  });

  it("resumes at the right step after signing in again", async () => {
    const t = await signedUp();
    markOverviewSeen(t.deps, t.current());
    await saveIdentity(t.deps, t.current(), identityFields, { front: file("poi-front.png"), selfie: file("selfie.png") });
    t.advance(t.deps.portal.otp.resend_cooldown_seconds * 1000);
    await startSignIn(t.deps, { email: account().email });
    const { sessionToken } = verifyOtp(t.deps, account().email, { code: t.lastCode() });
    const again = getSessionApplicant(t.deps, sessionToken)!;
    expect(resumeStep(stepCase(getCurrentCase(t.deps, again.id)))).toBe("residence");
  });

  it("blocks skipping ahead and editing after submission", async () => {
    const t = await signedUp();
    await expect(saveResidence(t.deps, t.current(), residenceFields, { por: file("por.png") })).rejects.toMatchObject({ code: "STEP_LOCKED" });
    await completeAllSteps(t);
    await submitCase(t.deps, t.current());
    expect(() => saveQuestionnaire(t.deps, t.current(), questionnaire)).toThrow(expect.objectContaining({ code: "NOT_EDITABLE" }));
  });

  describe("2.1.4 identity", () => {
    it("rejects an expired document and requires the back of an ID card", async () => {
      const t = await signedUp();
      markOverviewSeen(t.deps, t.current());
      await expect(
        saveIdentity(t.deps, t.current(), { ...identityFields, docType: "id_card", expiryDate: "2020-01-01" }, { front: file("f.png"), selfie: file("s.png") }),
      ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { expiryDate: [expect.stringMatching(/expired/)], back: [expect.any(String)] } });
    });

    it("accepts 'no expiration date' and rejects wrong file types", async () => {
      const t = await signedUp();
      markOverviewSeen(t.deps, t.current());
      await expect(
        saveIdentity(t.deps, t.current(), { docType: "passport", issuingCountry: "GR", noExpiry: "on" }, { front: file("f.gif", "image/gif"), selfie: file("s.png") }),
      ).rejects.toMatchObject({ fieldErrors: { front: [expect.any(String)] } });
      await saveIdentity(t.deps, t.current(), { docType: "passport", issuingCountry: "GR", noExpiry: "on" }, { front: file("f.png"), selfie: file("s.png") });
      expect(t.current().identity).toMatchObject({ noExpiry: true, complete: true });
    });

    it("asks for a selfie retake, then keeps the earlier upload when only the selfie changes", async () => {
      const t = await signedUp();
      markOverviewSeen(t.deps, t.current());
      await expect(
        saveIdentity(t.deps, t.current(), identityFields, { front: file("f.png"), selfie: file("selfie-mismatch.png") }),
      ).rejects.toMatchObject({ code: "SELFIE_RETRY" });
      expect(resumeStep(stepCase(t.current()))).toBe("identity");
      await saveIdentity(t.deps, t.current(), identityFields, { selfie: file("selfie-ok.png") });
      expect(t.current().identity).toMatchObject({ selfie: "passed", complete: true });
    });

    it("flags the case for the analyst after the last failed selfie instead of passing it", async () => {
      const t = await signedUp();
      markOverviewSeen(t.deps, t.current());
      const max = t.deps.portal.face_match.max_attempts;
      for (let i = 1; i < max; i++)
        await expect(saveIdentity(t.deps, t.current(), identityFields, { front: file("f.png"), selfie: file("spoof.png") })).rejects.toMatchObject({ code: "SELFIE_RETRY" });
      await saveIdentity(t.deps, t.current(), identityFields, { selfie: file("spoof.png") });
      expect(t.current().identity).toMatchObject({ selfie: "failed_flagged", complete: true });
    });
  });

  describe("2.1.5 residence", () => {
    it("refuses P.O. box addresses and badly formatted phones", async () => {
      const t = await signedUp();
      markOverviewSeen(t.deps, t.current());
      await saveIdentity(t.deps, t.current(), identityFields, { front: file("f.png"), selfie: file("s.png") });
      await expect(
        saveResidence(t.deps, t.current(), { ...residenceFields, addressLine1: "P.O. Box 123", mobilePhone: "0690" }, { por: file("por.png") }),
      ).rejects.toMatchObject({ fieldErrors: { addressLine1: [expect.stringMatching(/P\.O\. box/)], mobilePhone: [expect.any(String)] } });
    });
  });

  describe("2.1.6 questionnaire", () => {
    it("requires a TIN or a reason, the declaration, and closed-list answers", async () => {
      const t = await signedUp();
      markOverviewSeen(t.deps, t.current());
      await saveIdentity(t.deps, t.current(), identityFields, { front: file("f.png"), selfie: file("s.png") });
      await saveResidence(t.deps, t.current(), residenceFields, { por: file("por.png") });
      const { tin: _tin, declaration: _d, ...rest } = questionnaire;
      expect(() => saveQuestionnaire(t.deps, t.current(), { ...rest, employment_status: "astronaut" })).toThrow(
        expect.objectContaining({
          fieldErrors: expect.objectContaining({ tinMissingReason: expect.any(Array), declaration: expect.any(Array), employment_status: expect.any(Array) }),
        }),
      );
    });
  });

  describe("no tipping off (D7)", () => {
    it("US tax residents and prohibited countries still see only the neutral check screen, then the neutral no-go", async () => {
      for (const [email, answers, residence] of [
        ["us@example.test", { ...questionnaire, usTaxResident: "yes" }, residenceFields],
        ["ir@example.test", questionnaire, { ...residenceFields, country: "IR" }],
      ] as const) {
        const t = await signedUp(email);
        markOverviewSeen(t.deps, t.current());
        await saveIdentity(t.deps, t.current(), identityFields, { front: file("f.png"), selfie: file("s.png") });
        await saveResidence(t.deps, t.current(), residence, { por: file("por.png") });
        saveQuestionnaire(t.deps, t.current(), answers);
        await submitCase(t.deps, t.current());
        expect(t.current().riskResult).toMatchObject({ decision: "reject" });
        expect(t.current().thresholdResult).toBeNull();
        expect(applicantView(t.current())).toEqual({ kind: "check" });
        recordDecision(t.deps, t.current().id, "reject", "Engine hard rule confirmed", "dev");
        expect(applicantView(t.current())).toEqual({ kind: "no_go" });
      }
    });
  });

  it("requires a reason for every decision", async () => {
    const t = await signedUp();
    await completeAllSteps(t);
    await submitCase(t.deps, t.current());
    expect(() => recordDecision(t.deps, t.current().id, "approve", "  ", "dev")).toThrow(expect.objectContaining({ code: "VALIDATION" }));
  });
});
