import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, documentReadings, documents, faceMatches } from "@/db/schema";
import { ClaudeDocumentReader, type ParseCall } from "@/documents/claude-reader";
import { loadDocumentReadingConfig } from "@/documents/config";
import { checkRulesFromConfig } from "@/documents/factory";
import { runPreReview, type PreReviewDeps } from "@/documents/pre-review";
import { ReplayCache } from "@/documents/replay-cache";
import { createAccount, getSessionApplicant, verifyOtp } from "@/portal/accounts";
import { getCurrentCase, markOverviewSeen, saveIdentity, saveQuestionnaire, saveResidence, stepCase, submitCase, type IdentityData } from "@/portal/cases";
import { evidenceLevelOf, residencePrefill, satisfiesExtraKyc } from "@/portal/evidence";
import { resumeStep } from "@/portal/steps";
import { completeIdentityWithWallet, presentFromTestWallet, startWallet } from "@/portal/wallet";
import { poi, por } from "../documents/extractions";
import { account, file, identityFields, makeDeps, questionnaire, residenceFields } from "./helpers";

async function signedUp(persona: "individual" | "company" = "individual", email?: string) {
  const t = makeDeps();
  await createAccount(t.deps, { ...account(email), persona });
  const { sessionToken } = verifyOtp(t.deps, account(email).email, { code: t.lastCode() });
  const applicant = getSessionApplicant(t.deps, sessionToken)!;
  const current = () => getCurrentCase(t.deps, applicant.id);
  return { ...t, applicant, current };
}
type T = Awaited<ReturnType<typeof signedUp>>;

const audited = (t: T) => t.deps.db.select().from(auditLog).all();
const actions = (t: T) => audited(t).map((a) => a.action);
const identityOf = (t: T) => t.current().identity as IdentityData | null;

/** Answers that match what the test wallet holds (NL), so both routes score the same inputs. */
const answers = { ...questionnaire, dateOfBirth: "1990-05-01", nationality: "NL" };

describe("ID wallet route of step 2.1.4 (spec 09)", () => {
  it("completes the identity step with wallet evidence, no documents and no selfie", async () => {
    const t = await signedUp();
    markOverviewSeen(t.deps, t.current());
    presentFromTestWallet(t.deps, t.current(), "valid");

    const id = identityOf(t)!;
    expect(id).toMatchObject({ complete: true, selfie: "not_required", docType: "eudi_pid", issuingCountry: "NL", evidence: { source: "wallet", attributes: { givenName: "Ada", familyName: "Sample" } } });
    expect(evidenceLevelOf(id)).toBe("wallet_pid");
    expect(resumeStep(stepCase(t.current()))).toBe("residence");
    expect(t.deps.db.select().from(documents).all()).toHaveLength(0);
    expect(t.deps.db.select().from(faceMatches).all()).toHaveLength(0);

    expect(actions(t)).toEqual(expect.arrayContaining(["wallet.session_started", "wallet.verified", "step.completed"]));
    expect(actions(t)).not.toContain("face_match.result");
    const done = audited(t).filter((a) => a.action === "step.completed").at(-1)!;
    expect(done.payload).toMatchObject({ step: "identity", source: "wallet", assurance: "wallet_pid" });
    // The raw credential and the holder key never reach the case or the audit trail.
    expect(JSON.stringify([t.current().identity, audited(t)])).not.toMatch(/"d":|\.eyJ|~eyJ/);
  });

  it("scores and screens exactly like the document route for the same answers (the wallet decides nothing)", async () => {
    const w = await signedUp("individual", "wallet.user@example.test");
    markOverviewSeen(w.deps, w.current());
    presentFromTestWallet(w.deps, w.current(), "valid");
    await saveResidence(w.deps, w.current(), residenceFields, { por: file("por.pdf", "application/pdf") });
    saveQuestionnaire(w.deps, w.current(), answers);
    await submitCase(w.deps, w.current());

    const d = await signedUp("individual", "doc.user@example.test");
    markOverviewSeen(d.deps, d.current());
    await saveIdentity(d.deps, d.current(), identityFields, { front: file("poi.png"), selfie: file("selfie.png") });
    await saveResidence(d.deps, d.current(), residenceFields, { por: file("por.pdf", "application/pdf") });
    saveQuestionnaire(d.deps, d.current(), answers);
    await submitCase(d.deps, d.current());

    expect(w.current().status).toBe("submitted"); // still lands in the analyst queue
    expect(w.current().riskResult).toEqual(d.current().riskResult);
    expect(w.current().thresholdResult).toEqual(d.current().thresholdResult);
    expect(w.current().engineVersions).toEqual(d.current().engineVersions);
  });

  it("pre-fills the residence form from the PID address, still editable, and never replaces the proof of residence", async () => {
    const t = await signedUp();
    markOverviewSeen(t.deps, t.current());
    presentFromTestWallet(t.deps, t.current(), "valid");
    expect(residencePrefill(identityOf(t))).toEqual({ addressLine1: "Voorbeeldstraat 1", city: "Amsterdam", region: "Noord-Holland", postcode: "1011 AA", country: "NL" });
    await expect(saveResidence(t.deps, t.current(), residenceFields, {})).rejects.toMatchObject({ fieldErrors: { por: [expect.any(String)] } });
    await saveResidence(t.deps, t.current(), residenceFields, { por: file("por.pdf", "application/pdf") });
    expect(t.current().residence).toMatchObject({ country: "GR", complete: true }); // the applicant's edit stands
  });

  it("locks date of birth and nationality to what the wallet attested (O-76)", async () => {
    const t = await signedUp();
    markOverviewSeen(t.deps, t.current());
    presentFromTestWallet(t.deps, t.current(), "valid");
    await saveResidence(t.deps, t.current(), residenceFields, { por: file("por.pdf", "application/pdf") });
    saveQuestionnaire(t.deps, t.current(), { ...questionnaire, dateOfBirth: "1985-01-01", nationality: "GR" });
    expect(t.current().questionnaire).toMatchObject({ dateOfBirth: "1990-05-01", nationality: "NL" });
  });

  it("with several nationalities the applicant picks one of them, not any country", async () => {
    const t = await signedUp();
    markOverviewSeen(t.deps, t.current());
    const request = startWallet(t.deps, t.current());
    const token = t.deps.wallet.testWallet.present({ request, holder: { givenName: "Ada", familyName: "Sample", nationalities: ["NL", "GR"] }, scenario: "valid" });
    completeIdentityWithWallet(t.deps, t.current(), request.sessionId, token);
    await saveResidence(t.deps, t.current(), residenceFields, { por: file("por.pdf", "application/pdf") });
    saveQuestionnaire(t.deps, t.current(), { ...questionnaire, nationality: "GR" });
    expect(t.current().questionnaire).toMatchObject({ nationality: "GR" });
    saveQuestionnaire(t.deps, t.current(), { ...questionnaire, nationality: "FR" });
    expect(t.current().questionnaire).toMatchObject({ nationality: "NL" });
  });
});

describe("failure and fallback", () => {
  it("a rejected presentation tells the applicant nothing technical and audits the code for the analyst", async () => {
    const t = await signedUp();
    markOverviewSeen(t.deps, t.current());
    const err = await Promise.resolve()
      .then(() => presentFromTestWallet(t.deps, t.current(), "tampered_attribute"))
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "WALLET_FAILED" });
    expect((err as Error).message).not.toMatch(/WALLET_|signature|disclosure|nonce|issuer|tamper/i);
    expect(identityOf(t)).toBeNull();
    expect(resumeStep(stepCase(t.current()))).toBe("identity");
    const rejected = audited(t).find((a) => a.action === "wallet.rejected")!;
    expect(rejected.payload).toMatchObject({ code: "WALLET_DISCLOSURE_INVALID" });
    expect(actions(t)).not.toContain("wallet.verified");
  });

  it("every failing scenario is refused with the same neutral message", async () => {
    const messages = new Set<string>();
    for (const scenario of ["expired_credential", "untrusted_issuer", "tampered_attribute", "wrong_holder_key", "no_key_binding", "withheld_birthdate", "replay"]) {
      const t = await signedUp();
      markOverviewSeen(t.deps, t.current());
      try {
        presentFromTestWallet(t.deps, t.current(), scenario);
        throw new Error(`${scenario} was accepted`);
      } catch (e) {
        expect(e).toMatchObject({ code: "WALLET_FAILED" });
        messages.add((e as Error).message);
      }
      expect(identityOf(t)).toBeNull();
    }
    expect(messages.size).toBe(1);
  });

  it("after a failure the applicant can retry with a fresh session, or fall back to documents", async () => {
    const t = await signedUp();
    markOverviewSeen(t.deps, t.current());
    const first = startWallet(t.deps, t.current());
    expect(() => presentFromTestWallet(t.deps, t.current(), "expired_credential")).toThrow();
    const second = startWallet(t.deps, t.current());
    expect(second.sessionId).not.toBe(first.sessionId);
    presentFromTestWallet(t.deps, t.current(), "valid");
    expect(evidenceLevelOf(identityOf(t))).toBe("wallet_pid");

    const u = await signedUp("individual", "fallback@example.test");
    markOverviewSeen(u.deps, u.current());
    expect(() => presentFromTestWallet(u.deps, u.current(), "untrusted_issuer")).toThrow();
    await saveIdentity(u.deps, u.current(), identityFields, { front: file("poi.png"), selfie: file("selfie.png") });
    expect(identityOf(u)).toMatchObject({ selfie: "passed", complete: true });
    expect(identityOf(u)?.evidence).toBeUndefined();
    expect(evidenceLevelOf(identityOf(u))).toBe("document_selfie");
  });

  it("switching route replaces the evidence in both directions and never leaves stale identity images current", async () => {
    const t = await signedUp();
    markOverviewSeen(t.deps, t.current());
    await saveIdentity(t.deps, t.current(), identityFields, { front: file("poi.png"), selfie: file("selfie.png") });
    const current = () => t.deps.db.select().from(documents).all().filter((d) => d.supersededAt === null).map((d) => d.kind);
    expect(current().sort()).toEqual(["poi_front", "selfie"]);

    presentFromTestWallet(t.deps, t.current(), "valid");
    expect(current()).toEqual([]);
    expect(evidenceLevelOf(identityOf(t))).toBe("wallet_pid");

    // Back to documents: the wallet evidence goes, and the face match runs again from scratch.
    await expect(saveIdentity(t.deps, t.current(), identityFields, {})).rejects.toMatchObject({ code: "VALIDATION" });
    await saveIdentity(t.deps, t.current(), identityFields, { front: file("poi.png"), selfie: file("selfie.png") });
    expect(identityOf(t)).toMatchObject({ selfie: "passed" });
    expect(identityOf(t)?.evidence).toBeUndefined();
    expect(t.deps.db.select().from(faceMatches).all().length).toBeGreaterThanOrEqual(2);
  });

  it("is guarded like every step: locked before the overview, closed after submission, individuals only", async () => {
    const t = await signedUp();
    expect(() => startWallet(t.deps, t.current())).toThrow(expect.objectContaining({ code: "STEP_LOCKED" }));
    markOverviewSeen(t.deps, t.current());
    presentFromTestWallet(t.deps, t.current(), "valid");
    await saveResidence(t.deps, t.current(), residenceFields, { por: file("por.pdf", "application/pdf") });
    saveQuestionnaire(t.deps, t.current(), answers);
    await submitCase(t.deps, t.current());
    expect(() => presentFromTestWallet(t.deps, t.current(), "valid")).toThrow(expect.objectContaining({ code: "NOT_EDITABLE" }));

    const co = await signedUp("company", "company@example.test");
    markOverviewSeen(co.deps, co.current());
    expect(() => startWallet(co.deps, co.current())).toThrow(expect.objectContaining({ code: "VALIDATION" }));
  });

  it("an unknown scenario is a validation error, not a crash", async () => {
    const t = await signedUp();
    markOverviewSeen(t.deps, t.current());
    expect(() => presentFromTestWallet(t.deps, t.current(), "nonsense")).toThrow(expect.objectContaining({ code: "VALIDATION" }));
  });
});

describe("evidence-assurance ladder (spec 09 section 4)", () => {
  it("derives the level from stored evidence and applies the EDD extra-KYC rule per level", async () => {
    const cfg = makeDeps().deps.wallet.config;
    const doc = (selfie: IdentityData["selfie"], complete = true) => ({ ...identityFields, noExpiry: false, selfie, complete }) as IdentityData;

    expect(evidenceLevelOf(null)).toBeNull();
    expect(evidenceLevelOf(doc("retry", false))).toBeNull();
    expect(evidenceLevelOf(doc("passed"))).toBe("document_selfie");
    expect(evidenceLevelOf(doc("failed_flagged"))).toBe("document_selfie_flagged");

    // Documents: unchanged from before Phase 9 (spec 05: the selfie covered the extra KYC).
    expect(satisfiesExtraKyc(doc("passed"), cfg)).toBe(true);
    expect(satisfiesExtraKyc(doc("failed_flagged"), cfg)).toBe(false);
    expect(satisfiesExtraKyc(doc("retry", false), cfg)).toBe(false);
    expect(satisfiesExtraKyc(null, cfg)).toBe(false);

    const t = await signedUp();
    markOverviewSeen(t.deps, t.current());
    presentFromTestWallet(t.deps, t.current(), "valid");
    const wallet = identityOf(t);
    expect(satisfiesExtraKyc(wallet, cfg)).toBe(false); // O-70 default
    const lenient = { ...cfg, evidence_levels: cfg.evidence_levels.map((l) => (l.id === "wallet_pid" ? { ...l, satisfies_extra_kyc: true } : l)) };
    expect(satisfiesExtraKyc(wallet, lenient)).toBe(true); // a one-line config change
  });
});

describe("pre-review of a wallet case", () => {
  async function walletCase(scenario: string) {
    const t = await signedUp();
    const kinds: string[] = [];
    const deps: PreReviewDeps = {
      ...t.deps,
      checkRules: checkRulesFromConfig(),
      documentReader: (log) =>
        new ClaudeDocumentReader({
          model: "claude-sonnet-5-5",
          mode: "live",
          config: loadDocumentReadingConfig(),
          cache: new ReplayCache(fs.mkdtempSync(path.join(os.tmpdir(), "cache-"))),
          log,
          parse: (async (p: Parameters<ParseCall>[0]) => {
            const isPoi = JSON.stringify(p.messages).includes("proof-of-identity");
            kinds.push(isPoi ? "poi" : "por");
            return { parsed_output: isPoi ? poi() : por(), stop_reason: "end_turn", model: "claude-sonnet-5-5", usage: { input_tokens: 10, output_tokens: 5 } };
          }) as ParseCall,
        }),
    };
    markOverviewSeen(deps, t.current());
    presentFromTestWallet(deps, t.current(), scenario);
    await saveResidence(deps, t.current(), residenceFields, { por: file("por.png") });
    saveQuestionnaire(deps, t.current(), answers);
    await submitCase(deps, t.current());
    return { deps, t, kinds, run: () => runPreReview(deps, t.current().id) };
  }

  it("reads no identity document: code checks the attested attributes, Claude reads only the proof of residence", async () => {
    const { deps, t, kinds, run } = await walletCase("valid");
    const result = await run();
    expect(kinds).toEqual(["por"]);
    const byName = Object.fromEntries(result.checks.map((c) => [c.name, c.status]));
    expect(byName).toMatchObject({ wallet_evidence: "pass", poi_expiry: "pass", poi_name: "pass", dob: "pass" });
    expect(byName).not.toHaveProperty("selfie");
    expect(deps.db.select().from(documentReadings).where(eq(documentReadings.caseId, t.current().id)).all().map((r) => r.kind)).toEqual(["por"]);
  });

  it("flags a name on the credential that differs from the account, for the analyst to judge", async () => {
    const { run } = await walletCase("name_differs");
    const result = await run();
    expect(result.checks.find((c) => c.name === "poi_name")).toMatchObject({ status: "flag", reason_codes: ["NAME_MISMATCH"] });
    expect(result.summary.reasonCodes).toContain("NAME_MISMATCH");
  });
});
