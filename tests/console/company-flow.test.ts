import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, screeningHits } from "@/db/schema";
import { decide, startReview, triageHit } from "@/console/actions";
import { loadCaseView } from "@/console/case-view";
import { ClaudeDocumentReader, type ParseCall } from "@/documents/claude-reader";
import { loadDocumentReadingConfig } from "@/documents/config";
import { checkRulesFromConfig } from "@/documents/factory";
import { draftCaseMemo, type CaseMemo } from "@/documents/memo";
import { runPreReview, type PreReviewDeps } from "@/documents/pre-review";
import { ReplayCache } from "@/documents/replay-cache";
import { caseGaps } from "@/kyb/load";
import { createAccount, getSessionApplicant, verifyOtp } from "@/portal/accounts";
import { getCurrentCase, markOverviewSeen, saveIdentity, saveResidence, stepCase, submitCase } from "@/portal/cases";
import { confirmPersons, missingItems, saveCompany, saveCompanyDocuments, savePerson } from "@/portal/company";
import { applicantView } from "@/portal/decision";
import { resumeStep } from "@/portal/steps";
import { file, identityFields, makeDeps, residenceFields } from "../portal/helpers";
import { poi, por } from "../documents/extractions";

const company = {
  legalName: "Sample Holdings B.V.", registrationNumber: "SAMPLE-12345", countryOfIncorporation: "NL",
  addressLine1: "10 Example Plaza", city: "Amsterdam", postcode: "1011 AB", addressCountry: "NL",
  industry: "it", deposit_12m: "50k_250k", source_of_funds: "investment", declaration: "on",
};
const me = { fullName: "Ada Sample", dateOfBirth: "1990-05-01", nationality: "GR", countryOfResidence: "GR", roles: ["representative", "ubo", "shareholder", "director"], sharePercent: "60", pep: "no" };

function fakeClaude(): ParseCall {
  return async (p) => {
    const text = JSON.stringify(p.messages);
    const out = text.includes("Case facts")
      ? { summary: "Company with a register showing an undeclared shareholder. Review the gap list.", screening_notes: "", suggested_edd_requests: [], recommended_action: "needs_human_review" }
      : text.includes("proof-of-identity") ? poi() : text.includes("proof-of-residence") ? por()
      : { document_type: "register_of_members", company_name: "Sample Holdings B.V.", registration_number: "SAMPLE-12345", registered_address: null, issue_date: null,
          persons: [{ name: "Ada Sample", role: "shareholder", share_percent: 60 }, { name: "Cy Hidden", role: "shareholder", share_percent: 40 }], issues: [], issue_notes: "", overall_confidence: 0.9 };
    return { parsed_output: out, stop_reason: "end_turn", model: "claude-sonnet-5-5", usage: {} };
  };
}

async function companyCase(opts: { boCountry?: string } = {}) {
  const t = makeDeps();
  const deps: PreReviewDeps = {
    ...t.deps,
    checkRules: checkRulesFromConfig(),
    documentReader: (log) => new ClaudeDocumentReader({ model: "claude-sonnet-5-5", mode: "live", config: loadDocumentReadingConfig(), parse: fakeClaude(), cache: new ReplayCache(fs.mkdtempSync(path.join(os.tmpdir(), "c-"))), log }),
  };
  await createAccount(deps, { persona: "company", firstName: "Ada", lastName: "Sample", email: "rep@example.test" });
  const { sessionToken } = verifyOtp(deps, "rep@example.test", { code: t.lastCode() });
  const applicant = getSessionApplicant(deps, sessionToken)!;
  const current = () => getCurrentCase(deps, applicant.id);
  return { t, deps, current };
}

describe("company KYB flow", () => {
  it("walks the company steps, scores with the demo default, screens every person and builds the gap list", async () => {
    const { deps, current } = await companyCase();
    markOverviewSeen(deps, current());
    expect(resumeStep(stepCase(current()))).toBe("company");
    saveCompany(deps, current(), company);

    await savePerson(deps, current(), me, {}, { isApplicant: true });
    expect(() => confirmPersons(deps, current())).not.toThrow(); // representative + UBO covered by me
    await expect(savePerson(deps, current(), { ...me, fullName: "Bo Sample", roles: ["shareholder", "director"], sharePercent: "40", countryOfResidence: "KE" }, {})).rejects.toMatchObject({
      fieldErrors: { poi: [expect.any(String)], por: [expect.any(String)] },
    });
    await savePerson(deps, current(), { ...me, fullName: "Petros Demopoulos", dateOfBirth: "1971-08-30", roles: ["shareholder", "director"], sharePercent: "40" }, { poi: file("p-poi.png"), por: file("p-por.png") });
    confirmPersons(deps, current());

    await saveIdentity(deps, current(), identityFields, { front: file("poi.png"), selfie: file("selfie.png") });
    await saveResidence(deps, current(), residenceFields, { por: file("por.png") });
    expect(resumeStep(stepCase(current()))).toBe("documents");
    await saveCompanyDocuments(deps, current(), { certificate_of_incorporation: [file("coi.png")], register_of_members: [file("rom.png")] }, { finish: true });
    expect(missingItems(deps, current().id)).toHaveLength(deps.kyb.checklist.filter((i) => !i.provided_by).length - 2);

    await submitCase(deps, current());
    const c = current();
    expect(c.riskResult).toMatchObject({ band: "low", basis: "demo_default_o8" });
    expect(c.thresholdResult).toBeNull();

    const hits = deps.db.select().from(screeningHits).where(eq(screeningHits.caseId, c.id)).all();
    expect(hits.map((h) => h.entryId).sort()).toEqual(["WL-001", "WL-002"]); // Ada ~ "Ada Sampel"; Petros = PEP entry
    expect(hits.find((h) => h.entryId === "WL-002")!.subject).not.toBe("company");

    const declared = caseGaps(deps, c.id, false)!;
    expect(declared.filter((g) => g.code === "KYB_DOCUMENT_MISSING")).toHaveLength(missingItems(deps, c.id).length);
    expect(declared.some((g) => g.code === "KYB_SHAREHOLDING_NOT_100")).toBe(false);
  });

  it("confirming a person's PEP match re-scores the company to High; pre-review and memo stay advisory", async () => {
    const { deps, current } = await companyCase();
    markOverviewSeen(deps, current());
    saveCompany(deps, current(), company);
    await savePerson(deps, current(), me, {}, { isApplicant: true });
    await savePerson(deps, current(), { ...me, fullName: "Petros Demopoulos", dateOfBirth: "1971-08-30", roles: ["shareholder"], sharePercent: "40" }, { poi: file("p-poi.png"), por: file("p-por.png") });
    confirmPersons(deps, current());
    await saveIdentity(deps, current(), identityFields, { front: file("poi.png"), selfie: file("selfie.png") });
    await saveResidence(deps, current(), residenceFields, { por: file("por.png") });
    await saveCompanyDocuments(deps, current(), { unsorted: [file("scan.png")] }, { finish: true });
    await submitCase(deps, current());
    const id = current().id;

    // MVP 2: Claude classifies the untagged scan; the gap list now sees the register and an undeclared holder.
    const pre = await runPreReview(deps, id);
    expect(pre.gaps!.map((g) => g.code)).toEqual(expect.arrayContaining(["KYB_PERSON_WITHOUT_KYC"]));
    expect(pre.gaps!.some((g) => g.item === "register_of_members")).toBe(false);

    startReview(deps, id, "analyst-1");
    const pep = loadCaseView(deps, id).hits.find((h) => h.entryId === "WL-002")!;
    triageHit(deps, id, pep.id, "true_match", "Exact match", "analyst-1");
    expect(current().riskResult).toMatchObject({ band: "high", edd_required: true, driver: { kind: "person", name: "Petros Demopoulos" } });

    const memo = (await draftCaseMemo(deps, id, "analyst-1")) as CaseMemo;
    expect(memo.disclaimer).toBe("Advisory only. Decision rests with the analyst.");
    expect(memo.score_breakdown_restatement[0]).toMatch(/Company band high .* set by Petros Demopoulos/);
    expect(current().status).toBe("in_review"); // the memo never changes the case

    const ada = loadCaseView(deps, id).hits.find((h) => h.entryId === "WL-001")!;
    triageHit(deps, id, ada.id, "false_positive", "Different DOB", "analyst-1");
    expect(loadCaseView(deps, id).actions.approve).toMatchObject({ allowed: false, why: expect.stringMatching(/EDD/) });
    decide(deps, id, "reject", "Missing company documents", "analyst-1");
    expect(applicantView(current())).toEqual({ kind: "no_go" });
    expect(deps.db.select().from(auditLog).all().map((a) => a.action)).toEqual(expect.arrayContaining(["person.added", "memo.drafted", "engine.rescored", "prereview.completed"]));
  });
});
