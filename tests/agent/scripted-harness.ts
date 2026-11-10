import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auditLog } from "@/db/schema";
import { draftsFor } from "@/agent/drafts";
import { runTurn, type ChatTurn, type InterviewModel, type TurnResult } from "@/agent/interviewer";
import { callTool } from "@/agent/registry";
import { applicantRegistry } from "@/agent/tools/applicant";
import { createAccount, getSessionApplicant, verifyOtp } from "@/portal/accounts";
import { getCurrentCase, markOverviewSeen, saveIdentity, saveResidence } from "@/portal/cases";
import { presentFromTestWallet } from "@/portal/wallet";
import { file, identityFields, makeDeps, residenceFields } from "../portal/helpers";

// Scripted applicants (docs/spec/10 section 12): what a synthetic person says, the steps they finish on portal pages
// (as the inline cards would), and the answers that should end up saved. Shared by the replay tests and the recorder.

export const SCRIPT_CLOCK = "2026-11-10T10:00:00Z";

const answer = z.union([z.string(), z.boolean(), z.null()]);
export const scriptSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    note: z.string(),
    profile: z.enum(["cooperative", "vague", "self-contradicting", "hostile", "non-English"]),
    language: z.string().min(2),
    route: z.enum(["documents", "wallet"]),
    steps: z
      .array(
        z.union([
          z.object({ say: z.string().min(1), expect: z.enum(["deflection", "ignored"]).optional() }).strict(),
          z.object({ do: z.enum(["identity_documents", "identity_wallet", "residence"]) }).strict(),
        ]),
      )
      .min(1),
    expect: z.object({ answers: z.record(z.string(), answer), present: z.array(z.string()), reaches_review: z.literal(true) }).strict(),
  })
  .strict();
export type Script = z.infer<typeof scriptSchema>;

export function loadScripts(dir = path.resolve("fixtures/interviews")): Script[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => scriptSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))));
}

export type ScriptRun = {
  turns: { say: string; expect?: "deflection" | "ignored"; result: TurnResult }[];
  drafts: Record<string, unknown>;
  missing: string[];
  /** Model calls and their cost, from the audited claude.call entries. */
  calls: number;
  costUsd: number;
};

/** Plays one script against an in-memory demo with a fixed clock, so recordings and replays see the same tool results. */
export async function runScript(script: Script, model: InterviewModel): Promise<ScriptRun> {
  const t = makeDeps(SCRIPT_CLOCK);
  const email = `${script.id}@example.test`;
  await createAccount(t.deps, { persona: "individual", firstName: "Ada", lastName: "Sample", email });
  const { sessionToken } = verifyOtp(t.deps, email, { code: t.lastCode() });
  const applicant = getSessionApplicant(t.deps, sessionToken)!;
  const current = () => getCurrentCase(t.deps, applicant.id);
  markOverviewSeen(t.deps, current()); // the applicant came to the assistant from the overview

  const history: ChatTurn[] = [];
  const turns: ScriptRun["turns"] = [];
  for (const step of script.steps) {
    if ("do" in step) {
      if (step.do === "identity_documents") await saveIdentity(t.deps, current(), identityFields, { front: file("poi.png"), selfie: file("selfie.png") });
      else if (step.do === "identity_wallet") presentFromTestWallet(t.deps, current(), "valid");
      else await saveResidence(t.deps, current(), residenceFields, { por: file("por.png") });
      continue;
    }
    const result = await runTurn(t.deps, { applicantId: applicant.id, history, message: step.say }, model);
    turns.push({ say: step.say, ...(step.expect ? { expect: step.expect } : {}), result });
    history.push({ role: "user", text: step.say }, { role: "assistant", text: result.reply });
  }

  const drafts = Object.fromEntries(Object.entries(draftsFor(t.deps, current().id, "questionnaire")).map(([k, d]) => [k, d.value]));
  const summary = await callTool(applicantRegistry, { deps: t.deps, actor: `applicant:${applicant.id}`, channel: "portal" }, "get_review_summary", {});
  const missing = summary.ok ? (summary.output as { missing: string[] }).missing : ["(summary failed)"];
  const interview = t.deps.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "claude.call"))
    .all()
    .map((r) => r.payload as { kind?: string; costUsd?: number })
    .filter((p) => p?.kind === "interview");
  return { turns, drafts, missing, calls: interview.length, costUsd: interview.reduce((s, p) => s + (p.costUsd ?? 0), 0) };
}
