import { callTool, type ToolContext } from "@/agent/registry";
import { applicantRegistry } from "@/agent/tools/applicant";
import { createAccount, getSessionApplicant, verifyOtp } from "@/portal/accounts";
import { getCurrentCase, markOverviewSeen, saveIdentity, saveResidence } from "@/portal/cases";
import { presentFromTestWallet } from "@/portal/wallet";
import { account, file, identityFields, makeDeps, residenceFields } from "../portal/helpers";

// Phase 10a test helpers: an applicant taken to a given step, and the tool wrapper bound to them.

export type Stage = "overview" | "identity" | "residence" | "questionnaire";

export async function applicantAt(stage: Stage, opts: { email?: string; wallet?: boolean; deps?: ReturnType<typeof makeDeps> } = {}) {
  const t = opts.deps ?? makeDeps();
  const email = opts.email ?? account().email;
  await createAccount(t.deps, { ...account(email), persona: "individual" });
  const { sessionToken } = verifyOtp(t.deps, email, { code: t.lastCode() });
  const applicant = getSessionApplicant(t.deps, sessionToken)!;
  const current = () => getCurrentCase(t.deps, applicant.id);
  if (stage !== "overview") {
    markOverviewSeen(t.deps, current());
    if (stage !== "identity") {
      if (opts.wallet) presentFromTestWallet(t.deps, current(), "valid");
      else await saveIdentity(t.deps, current(), identityFields, { front: file("poi.png"), selfie: file("selfie.png") });
      if (stage === "questionnaire") await saveResidence(t.deps, current(), residenceFields, { por: file("por.png") });
    }
  }
  return { ...t, applicant, current };
}

export const ctxFor = (a: { deps: ToolContext["deps"]; applicant: { id: string } }, channel: ToolContext["channel"] = "portal", client?: ToolContext["client"]): ToolContext => ({
  deps: a.deps,
  actor: `applicant:${a.applicant.id}`,
  channel,
  ...(client ? { client } : {}),
});

export const call = (ctx: ToolContext, name: string, input: unknown = {}) => callTool(applicantRegistry, ctx, name, input);

/** The answers in tests/portal/helpers `questionnaire`, as an agent would send them (no declaration). */
export const agentAnswers = {
  dateOfBirth: "1990-05-01",
  nationality: "GR",
  preferredLanguage: "en",
  phone: "+30 690 000 0000",
  tin: "SAMPLE-TIN-1",
  usTaxResident: "no",
  pep: "no",
  deposit_12m: "lt_20k",
  source_of_funds: "salary",
  onlySourceOfWealth: false,
  employment_status: "employed",
  occupation_industry: "it",
  annual_income: "lt_50k",
  net_worth: "lt_50k",
} as const;
