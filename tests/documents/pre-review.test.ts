import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, documentReadings } from "@/db/schema";
import { ClaudeDocumentReader, type ParseCall } from "@/documents/claude-reader";
import { loadDocumentReadingConfig } from "@/documents/config";
import { checkRulesFromConfig } from "@/documents/factory";
import { runPreReview, type PreReviewDeps } from "@/documents/pre-review";
import { ReplayCache } from "@/documents/replay-cache";
import { createAccount, getSessionApplicant, verifyOtp } from "@/portal/accounts";
import { getCurrentCase, markOverviewSeen, saveIdentity, saveQuestionnaire, saveResidence, submitCase } from "@/portal/cases";
import { applicantView } from "@/portal/decision";
import { account, file, identityFields, makeDeps, questionnaire, residenceFields } from "../portal/helpers";
import { poi, por } from "./extractions";

async function submittedCase(parse: ParseCall) {
  const t = makeDeps();
  const deps: PreReviewDeps = {
    ...t.deps,
    checkRules: checkRulesFromConfig(),
    documentReader: (log) =>
      new ClaudeDocumentReader({
        model: "claude-sonnet-5-5",
        mode: "live",
        config: loadDocumentReadingConfig(),
        parse,
        cache: new ReplayCache(fs.mkdtempSync(path.join(os.tmpdir(), "cache-"))),
        log,
      }),
  };
  await createAccount(deps, account());
  const { sessionToken } = verifyOtp(deps, account().email, { code: t.lastCode() });
  const applicant = getSessionApplicant(deps, sessionToken)!;
  const current = () => getCurrentCase(deps, applicant.id);
  markOverviewSeen(deps, current());
  await saveIdentity(deps, current(), identityFields, { front: file("poi.png"), selfie: file("selfie.png") });
  await saveResidence(deps, current(), residenceFields, { por: file("por.png") });
  saveQuestionnaire(deps, current(), questionnaire);
  await submitCase(deps, current());
  return { deps, current };
}

const replyFor = (params: Parameters<ParseCall>[0], poiOut: unknown, porOut: unknown) => {
  const text = JSON.stringify(params.messages);
  return { parsed_output: text.includes("proof-of-identity") ? poiOut : porOut, stop_reason: "end_turn", model: "claude-sonnet-5-5", usage: { input_tokens: 10, output_tokens: 5 } };
};

describe("pre-review (MVP 2)", () => {
  it("stores checks, document readings and an audited Claude call per document, without touching status or score", async () => {
    const { deps, current } = await submittedCase(async (p) => replyFor(p, poi(), por({ document_category: "mobile_bill" })));
    const before = current();
    const result = await runPreReview(deps, before.id);

    expect(result.summary.reasonCodes).toEqual(["POR_MOBILE_BILL"]);
    const after = current();
    expect(after.preReview).toMatchObject({ summary: { fail: 1 } });
    expect(after.status).toBe(before.status);
    expect(after.riskResult).toEqual(before.riskResult);
    expect(applicantView(after)).toEqual({ kind: "check" }); // never shown to the applicant

    const readings = deps.db.select().from(documentReadings).where(eq(documentReadings.caseId, after.id)).all();
    expect(readings.map((r) => [r.kind, r.status, r.model, r.promptVersion])).toEqual([
      ["poi", "ok", "claude-sonnet-5-5", loadDocumentReadingConfig().prompt_version],
      ["por", "ok", "claude-sonnet-5-5", loadDocumentReadingConfig().prompt_version],
    ]);
    const calls = deps.db.select().from(auditLog).where(eq(auditLog.action, "claude.call")).all();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.actor).toBe("claude");
    expect(calls[0]!.payload).toMatchObject({ model: "claude-sonnet-5-5", promptVersion: expect.any(String), inputHash: expect.stringMatching(/^[0-9a-f]{64}$/), output: expect.any(Object) });
  });

  it("routes a failed extraction to the analyst instead of passing it", async () => {
    const { deps, current } = await submittedCase(async (p) => replyFor(p, null, por()));
    const result = await runPreReview(deps, current().id);
    expect(result.checks).toContainEqual(expect.objectContaining({ name: "poi_extraction", status: "flag", reason_codes: ["POI_UNCLEAR"] }));
  });
});
