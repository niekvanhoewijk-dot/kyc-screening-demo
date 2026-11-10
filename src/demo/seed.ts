import { eq } from "drizzle-orm";
import { MemoryMailer } from "@/adapters/mailer";
import {
  applicants,
  auditLog,
  casePersons,
  cases,
  decisionRecords,
  documentReadings,
  documents,
  faceMatches,
  intakeDrafts,
  otpChallenges,
  policyDrafts,
  screeningHits,
  sessions,
  settings,
  simCustomers,
  walletSessions,
} from "@/db/schema";
import { ClaudeDocumentReader } from "@/documents/claude-reader";
import { loadDocumentReadingConfig } from "@/documents/config";
import { draftCaseMemo, memoFacts } from "@/documents/memo";
import { runPreReview, type PreReviewDeps } from "@/documents/pre-review";
import { ReplayCache } from "@/documents/replay-cache";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { sha256 } from "@/lib/ids";
import { createAccount, verifyOtp } from "@/portal/accounts";
import { getCurrentCase, markOverviewSeen, saveIdentity, saveQuestionnaire, saveResidence, submitCase } from "@/portal/cases";
import { confirmPersons, saveCompany, saveCompanyDocuments, savePerson } from "@/portal/company";
import { fixtureUpload, loadPersonas, type IndividualPersona } from "./personas";
import { DEMO_KEYS, identityOf, questionnaireInput, residenceOf } from "./prefill";

export type ClaudeSeedMode = "skip" | "run" | "auto";
export type SeedResult = {
  cases: { personaId: string; caseId: string; band: string | null }[];
  claude: { mode: ClaudeSeedMode; preReviews: number; memos: number; note: string };
};

/** Deletes every case, applicant, document, audit entry and setting (demo only). */
export async function wipeDemoData(deps: PreReviewDeps) {
  deps.db.transaction((tx) => {
    for (const t of [auditLog, decisionRecords, simCustomers, policyDrafts, intakeDrafts, documentReadings, faceMatches, screeningHits, documents, casePersons, walletSessions, otpChallenges, sessions, cases, applicants, settings]) tx.delete(t).run();
  });
  await deps.files.clear();
}

async function signUp(deps: PreReviewDeps, persona: "individual" | "company", first: string, last: string, email: string) {
  const mailer = new MemoryMailer();
  const d = { ...deps, mailer };
  await createAccount(d, { persona, firstName: first, lastName: last, email });
  const code = /code is (\d+)/.exec(mailer.sent.at(-1)!.text)![1]!;
  verifyOtp(d, email, { code });
  const applicant = d.db.select().from(applicants).where(eq(applicants.email, email)).get()!;
  return () => getCurrentCase(d, applicant.id);
}

async function seedIndividual(deps: PreReviewDeps, p: IndividualPersona) {
  const current = await signUp(deps, "individual", p.first, p.last, p.email);
  markOverviewSeen(deps, current());
  await saveIdentity(deps, current(), identityOf(p), { front: fixtureUpload(`${p.id}-poi.png`), selfie: fixtureUpload("selfie.png") });
  await saveResidence(deps, current(), residenceOf(p), { por: fixtureUpload(`${p.id}-por.png`) });
  saveQuestionnaire(deps, current(), questionnaireInput(p));
  await submitCase(deps, current());
  return current();
}

async function seedCompany(deps: PreReviewDeps) {
  const personas = loadPersonas();
  const co = personas.company;
  const rep = personas.individuals.find((p) => p.id === co.representative.personaId)!;
  const current = await signUp(deps, "company", rep.first, rep.last, co.representative.email);
  markOverviewSeen(deps, current());
  saveCompany(deps, current(), { ...co.company, declaration: "on" });
  await savePerson(
    deps,
    current(),
    { fullName: `${rep.first} ${rep.last}`, dateOfBirth: rep.dob, nationality: rep.nationality, countryOfResidence: rep.address.country, roles: co.representativeRoles, sharePercent: co.representativeShare, pep: "no" },
    {},
    { isApplicant: true },
  );
  for (const o of co.others)
    await savePerson(
      deps,
      current(),
      { fullName: o.fullName, dateOfBirth: o.dob, nationality: o.nationality, countryOfResidence: o.address.country, roles: o.roles, sharePercent: o.share, pep: "no" },
      { poi: fixtureUpload(`${o.id}-poi.png`), por: fixtureUpload(`${o.id}-por.png`) },
    );
  confirmPersons(deps, current());
  await saveIdentity(deps, current(), identityOf(rep), { front: fixtureUpload(`${rep.id}-poi.png`), selfie: fixtureUpload("selfie.png") });
  await saveResidence(deps, current(), residenceOf(rep), { por: fixtureUpload(`${rep.id}-por.png`) });
  await saveCompanyDocuments(deps, current(), Object.fromEntries(Object.entries(co.documents).map(([item, f]) => [item, [fixtureUpload(f)]])), { finish: true });
  await submitCase(deps, current());
  return current();
}

/** Whether replay has a recorded answer for every document read and memo of a seeded case. */
function replayReady(deps: PreReviewDeps, caseId: string, stage: "documents" | "memo", cache: ReplayCache, model: string): boolean {
  const reader = new ClaudeDocumentReader({ model, mode: "replay", config: loadDocumentReadingConfig(), cache });
  if (stage === "memo") return cache.get(reader.cacheKey("memo", { sha256: sha256(JSON.stringify(memoFacts(deps, caseId), null, 2)) })) !== null;
  const docs = deps.db.select().from(documents).where(eq(documents.caseId, caseId)).all();
  const KIND = { poi_front: "poi", por: "por", company_doc: "kyb" } as const;
  const reads = docs.flatMap((d) => (d.kind in KIND && !d.personId ? [{ kind: KIND[d.kind as keyof typeof KIND], sha256: d.sha256 }] : []));
  return reads.every((r) => cache.get(reader.cacheKey(r.kind, { sha256: r.sha256 })) !== null);
}

/**
 * Wipes the demo and seeds the synthetic personas through the real portal services.
 * Claude: "run" calls the configured reader (record with a live reader); "auto" replays only when
 * every response is recorded; "skip" leaves pre-review and memo for the analyst to start.
 */
export async function resetDemo(
  deps: PreReviewDeps,
  opts: { claude: ClaudeSeedMode; actor: string; cache?: ReplayCache; model?: string },
): Promise<SeedResult> {
  const cache = opts.cache ?? new ReplayCache();
  const model = opts.model ?? env.CLAUDE_MODEL;
  // Demo Mode is a presentation setting: it survives a reset (the per-applicant bindings go with the applicants).
  const keep = deps.db.select().from(settings).all().filter((r) => (DEMO_KEYS as readonly string[]).includes(r.key));
  await wipeDemoData(deps);
  for (const r of keep) deps.db.insert(settings).values(r).run();
  const personas = loadPersonas();
  const seeded: SeedResult["cases"] = [];
  for (const p of personas.individuals) {
    const c = await seedIndividual(deps, p);
    seeded.push({ personaId: p.id, caseId: c.id, band: (c.riskResult as { band?: string } | null)?.band ?? null });
  }
  const co = await seedCompany(deps);
  seeded.push({ personaId: personas.company.id, caseId: co.id, band: (co.riskResult as { band?: string } | null)?.band ?? null });

  let preReviews = 0;
  let memos = 0;
  if (opts.claude !== "skip") {
    for (const s of seeded) {
      if (opts.claude === "auto" && !replayReady(deps, s.caseId, "documents", cache, model)) continue;
      await runPreReview(deps, s.caseId);
      preReviews++;
      if (opts.claude === "auto" && !replayReady(deps, s.caseId, "memo", cache, model)) continue;
      if (!("error" in (await draftCaseMemo(deps, s.caseId, "demo-seed")))) memos++;
    }
  }
  const note =
    opts.claude === "skip" ? "Claude not run." : preReviews < seeded.length ? `Claude replay ran for ${preReviews} of ${seeded.length} cases; record the rest with npm run demo:record.` : `Claude ran for all ${seeded.length} cases.`;
  audit(deps.db, deps.now(), opts.actor === "cli" ? "system" : `analyst:${opts.actor}`, "demo.reset", null, { cases: seeded.length, preReviews, memos, claude: opts.claude });
  return { cases: seeded, claude: { mode: opts.claude, preReviews, memos, note } };
}
