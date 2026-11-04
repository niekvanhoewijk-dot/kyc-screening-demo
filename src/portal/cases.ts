import { and, desc, eq, isNull } from "drizzle-orm";
import { applicants, casePersons, cases, documents, faceMatches, screeningHits } from "@/db/schema";
import { initialThreshold, scoreApplicant, scoreCompany, type CompanyInputs, type DecisionInputs, type IndividualInputs, type Policy } from "@/engine";
import { appendRecord } from "@/records/store";
import { audit } from "@/lib/audit";
import { newId, sha256 } from "@/lib/ids";
import type { PortalDeps } from "./deps";
import { PortalError, type FieldErrors } from "./errors";
import {
  identityFieldsSchema,
  parseOrThrow,
  questionnaireSchema,
  residenceFieldsSchema,
  type IdentityFields,
  type QuestionnaireAnswers,
  type ResidenceFields,
} from "./schemas";
import { canOpen, type StepId } from "./steps";
import { lockedFromWallet } from "./evidence";
import type { WalletEvidence } from "@/wallet/types";

export type CaseRow = typeof cases.$inferSelect;
export type UploadInput = { name: string; type: string; size: number; bytes: Buffer };
type DocKind = (typeof documents.$inferSelect)["kind"];

/**
 * `evidence` is present when the identity came from an ID wallet (docs/spec/09); the selfie is then
 * "not_required". The evidence-assurance level is derived from this in portal/evidence.ts, never stored.
 */
export type IdentityData = IdentityFields & { selfie: "passed" | "retry" | "failed_flagged" | "not_required"; complete: boolean; evidence?: WalletEvidence };
export type ResidenceData = ResidenceFields & { complete: boolean };
export type QuestionnaireData = QuestionnaireAnswers & { complete: boolean };

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };
const today = (d: Date) => d.toISOString().slice(0, "yyyy-mm-dd".length);

export function getCurrentCase(deps: PortalDeps, applicantId: string): CaseRow {
  const row = deps.db.select().from(cases).where(eq(cases.applicantId, applicantId)).orderBy(desc(cases.createdAt)).get();
  if (!row) throw new PortalError("NOT_FOUND", "We couldn't find your application.");
  return row;
}

export const stepCase = (c: CaseRow) => ({
  persona: c.persona,
  company: c.company as { complete?: boolean } | null,
  persons: c.persons as { complete?: boolean } | null,
  companyDocs: c.companyDocs as { complete?: boolean } | null,
  status: c.status,
  overviewSeenAt: c.overviewSeenAt,
  identity: c.identity as IdentityData | null,
  residence: c.residence as ResidenceData | null,
  questionnaire: c.questionnaire as QuestionnaireData | null,
});

export function assertEditable(c: CaseRow, step: StepId) {
  if (c.status !== "draft") throw new PortalError("NOT_EDITABLE", "Your application has been submitted and can no longer be changed.");
  if (!canOpen(step, stepCase(c))) throw new PortalError("STEP_LOCKED", "Please complete the earlier steps first.");
}

function currentDoc(deps: PortalDeps, caseId: string, kind: DocKind) {
  return deps.db
    .select()
    .from(documents)
    .where(and(eq(documents.caseId, caseId), eq(documents.kind, kind), isNull(documents.supersededAt)))
    .get();
}

export function checkUpload(deps: PortalDeps, field: string, file: UploadInput | undefined, mimes: string[], errors: FieldErrors) {
  if (!file || file.size === 0) return undefined;
  const maxMb = Math.round(deps.portal.uploads.max_bytes / 1_048_576);
  if (!mimes.includes(file.type)) errors[field] = [`Upload a ${mimes.map((m) => EXT[m] ?? m).join(", ")} file`];
  else if (file.size > deps.portal.uploads.max_bytes) errors[field] = [`The file is larger than ${maxMb} MB`];
  return file;
}

/** Stores an upload. By default it supersedes the current document of that kind; SoF evidence accumulates instead. */
export async function storeDoc(deps: PortalDeps, c: CaseRow, kind: DocKind, file: UploadInput, docType: string | null, opts: { keepPrevious?: boolean; personId?: string } = {}) {
  const now = deps.now();
  const id = newId();
  const storedPath = await deps.files.save(c.id, `${kind}-${id}.${EXT[file.type] ?? "bin"}`, file.bytes);
  const hash = sha256(file.bytes);
  deps.db.transaction((tx) => {
    if (!opts.keepPrevious)
      tx.update(documents)
        .set({ supersededAt: now.toISOString() })
        .where(
          and(
            eq(documents.caseId, c.id),
            eq(documents.kind, kind),
            isNull(documents.supersededAt),
            opts.personId ? eq(documents.personId, opts.personId) : isNull(documents.personId),
          ),
        )
        .run();
    tx.insert(documents)
      .values({ id, caseId: c.id, personId: opts.personId ?? null, kind, docType, originalName: file.name, storedPath, mime: file.type, sizeBytes: file.size, sha256: hash, uploadedAt: now.toISOString() })
      .run();
  });
  audit(deps.db, now, `applicant:${c.applicantId}`, "document.uploaded", `case:${c.id}`, { documentId: id, kind, docType, personId: opts.personId, sha256: hash, sizeBytes: file.size });
  return { id, name: file.name, bytes: file.bytes };
}

export function touch(deps: PortalDeps, caseId: string, set: Partial<typeof cases.$inferInsert>) {
  deps.db.update(cases).set({ ...set, updatedAt: deps.now().toISOString() }).where(eq(cases.id, caseId)).run();
}

export function markOverviewSeen(deps: PortalDeps, c: CaseRow) {
  if (c.overviewSeenAt || c.status !== "draft") return;
  touch(deps, c.id, { overviewSeenAt: deps.now().toISOString() });
  audit(deps.db, deps.now(), `applicant:${c.applicantId}`, "step.completed", `case:${c.id}`, { step: "overview" });
}

/** 2.1.4 POI + selfie (D5). Files already uploaded are kept when the applicant returns and does not replace them. */
export async function saveIdentity(
  deps: PortalDeps,
  c: CaseRow,
  input: unknown,
  files: { front?: UploadInput; back?: UploadInput; selfie?: UploadInput },
) {
  assertEditable(c, "identity");
  const now = deps.now();
  const errors: FieldErrors = {};
  let fields: IdentityFields | undefined;
  try {
    fields = parseOrThrow(identityFieldsSchema(deps.portal, today(now)), input);
  } catch (e) {
    if (!(e instanceof PortalError)) throw e;
    Object.assign(errors, e.fieldErrors);
  }
  const { document_mime, selfie_mime } = deps.portal.uploads;
  const front = checkUpload(deps, "front", files.front, document_mime, errors);
  const back = checkUpload(deps, "back", files.back, document_mime, errors);
  const selfie = checkUpload(deps, "selfie", files.selfie, selfie_mime, errors);

  // Read the doc type from the raw input too, so every missing file is reported in one pass.
  const docType = fields?.docType ?? (input as { docType?: unknown } | null)?.docType;
  const needsBack = deps.portal.poi.document_types.find((d) => d.id === docType)?.needs_back ?? false;
  if (!front && !currentDoc(deps, c.id, "poi_front")) errors.front ??= ["Upload the front of your document"];
  if (needsBack && !back && !currentDoc(deps, c.id, "poi_back")) errors.back ??= ["Upload the back of your document"];
  if (!selfie && !currentDoc(deps, c.id, "selfie")) errors.selfie ??= ["Take or upload a selfie"];
  if (!fields || Object.keys(errors).length) throw new PortalError("VALIDATION", "Please check the highlighted fields.", errors);

  const frontDoc = front ? await storeDoc(deps, c, "poi_front", front, fields.docType) : undefined;
  if (back) await storeDoc(deps, c, "poi_back", back, fields.docType);
  const selfieDoc = selfie ? await storeDoc(deps, c, "selfie", selfie, null) : undefined;

  // Face match runs whenever the selfie or the POI picture changed, or no result exists yet.
  const previous = c.identity as IdentityData | null;
  // A wallet identity has no selfie; switching to documents starts the face match from scratch.
  let selfieState = previous?.selfie === "not_required" ? undefined : previous?.selfie;
  if (frontDoc || selfieDoc || !selfieState || selfieState === "retry") {
    const s = selfieDoc ?? currentDoc(deps, c.id, "selfie")!;
    const f = frontDoc ?? currentDoc(deps, c.id, "poi_front")!;
    const [selfieBytes, frontBytes] = await Promise.all([
      "bytes" in s ? s.bytes : deps.files.read(s.storedPath),
      "bytes" in f ? f.bytes : deps.files.read(f.storedPath),
    ]);
    const result = await deps.faceMatch.check({
      selfie: selfieBytes,
      selfieName: "originalName" in s ? s.originalName : s.name,
      poiFront: frontBytes,
      poiFrontName: "originalName" in f ? f.originalName : f.name,
    });
    deps.db.insert(faceMatches).values({ id: newId(), caseId: c.id, selfieDocumentId: s.id, ...result, createdAt: now.toISOString() }).run();
    audit(deps.db, now, "system", "face_match.result", `case:${c.id}`, result);
    const failures = deps.db
      .select()
      .from(faceMatches)
      .where(eq(faceMatches.caseId, c.id))
      .all()
      .filter((m) => m.liveness === "fail" || m.match === "fail").length;
    const passed = result.liveness === "pass" && result.match === "pass";
    // Never auto-passes: after the last attempt the case continues, flagged for the analyst.
    selfieState = passed ? "passed" : failures >= deps.portal.face_match.max_attempts ? "failed_flagged" : "retry";
  }

  const identity: IdentityData = { ...fields, selfie: selfieState, complete: selfieState !== "retry" };
  touch(deps, c.id, { identity });
  audit(deps.db, now, `applicant:${c.applicantId}`, identity.complete ? "step.completed" : "step.saved", `case:${c.id}`, { step: "identity", selfie: selfieState });
  if (selfieState === "retry")
    throw new PortalError("SELFIE_RETRY", "We couldn't verify your selfie. Retake it in good light, facing the camera, and upload it again.", {
      selfie: ["Please retake your selfie"],
    });
}

/** 2.1.5 Address + one POR document (D10). */
export async function saveResidence(deps: PortalDeps, c: CaseRow, input: unknown, files: { por?: UploadInput }) {
  assertEditable(c, "residence");
  const errors: FieldErrors = {};
  let fields: ResidenceFields | undefined;
  try {
    fields = parseOrThrow(residenceFieldsSchema(deps.portal), input);
  } catch (e) {
    if (!(e instanceof PortalError)) throw e;
    Object.assign(errors, e.fieldErrors);
  }
  const por = checkUpload(deps, "por", files.por, deps.portal.uploads.document_mime, errors);
  if (!por && !currentDoc(deps, c.id, "por")) errors.por ??= ["Upload your proof of residence"];
  if (!fields || Object.keys(errors).length) throw new PortalError("VALIDATION", "Please check the highlighted fields.", errors);

  if (por) await storeDoc(deps, c, "por", por, fields.porType);
  touch(deps, c.id, { residence: { ...fields, complete: true } satisfies ResidenceData });
  audit(deps.db, deps.now(), `applicant:${c.applicantId}`, "step.completed", `case:${c.id}`, { step: "residence" });
}

/** 2.1.6 Questionnaire. Scoring happens at submission and is never shown to the applicant. */
export function saveQuestionnaire(deps: PortalDeps, c: CaseRow, input: unknown) {
  assertEditable(c, "questionnaire");
  // Attributes the ID wallet attested are not the applicant's to retype (O-76): the server uses the verified values.
  const locked = lockedFromWallet(c.identity as IdentityData | null);
  const posted = (input ?? {}) as Record<string, unknown>;
  const merged = locked
    ? { ...posted, dateOfBirth: locked.birthDate, nationality: locked.nationalities.includes(String(posted.nationality)) ? posted.nationality : locked.nationalities[0] }
    : input;
  const answers = parseOrThrow(questionnaireSchema(deps.engine, deps.portal, today(deps.now())), merged);
  touch(deps, c.id, { questionnaire: { ...answers, complete: true } satisfies QuestionnaireData });
  audit(deps.db, deps.now(), `applicant:${c.applicantId}`, "step.completed", `case:${c.id}`, { step: "questionnaire" });
}

/**
 * Rules engine over the stored answers. `pepConfirmed` applies an analyst-confirmed PEP screening
 * match (D9: PEP = band at least High) on top of the self-declaration.
 */
export function scoreCase(deps: PortalDeps, c: CaseRow, opts: { pepConfirmed?: boolean; pepPersonIds?: string[]; policy?: Policy } = {}) {
  // spec 08 5.5: scored under the policy in force on the wall clock at the time of scoring,
  // unless the simulator applies another policy to demo data.
  const policy = opts.policy ?? deps.policies.inForce(deps.now().toISOString());
  if (c.persona === "company") return scoreCompanyCase(deps, c, policy, opts.pepPersonIds ?? []);
  const q = c.questionnaire as QuestionnaireData;
  const r = c.residence as ResidenceData;
  const inputs: IndividualInputs = {
    type: "individual",
    country: r.country,
    factor_answers: {
      deposit_12m: q.deposit_12m,
      source_of_funds: q.source_of_funds,
      employment_status: q.employment_status,
      occupation_industry: q.occupation_industry,
      annual_income: q.annual_income,
      net_worth: q.net_worth,
    },
    pep: q.pep || opts.pepConfirmed === true,
    us_tax_resident: q.usTaxResident,
    only_source_of_wealth: q.onlySourceOfWealth,
  };
  const risk = scoreApplicant({ country: inputs.country, pep: inputs.pep, us_tax_resident: inputs.us_tax_resident, ...inputs.factor_answers }, policy);
  const threshold =
    "total" in risk && !risk.decision
      ? initialThreshold(
          {
            deposit_12m: q.deposit_12m,
            source_of_funds: q.source_of_funds,
            only_source_of_wealth: q.onlySourceOfWealth,
            employment_status: q.employment_status,
            annual_income: q.annual_income,
            band: risk.band,
          },
          policy,
        )
      : null;
  return { risk, threshold, engineVersions: versions(deps, policy), policy, inputs: inputs as DecisionInputs };
}

const versions = (deps: PortalDeps, policy: Policy) => ({
  policy_id: policy.policy.id,
  policy_hash: policy.policy.hash,
  risk_matrix_version: policy.matrix.version,
  country_list_version: policy.countries.meta.list_version,
  country_as_of: policy.countries.meta.as_of,
  kyb_version: deps.kyb.version,
});

/** Company: demo default (spec 03, O-8). No company threshold is defined (O-32). */
function scoreCompanyCase(deps: PortalDeps, c: CaseRow, policy: Policy, pepPersonIds: string[]) {
  const company = c.company as { countryOfIncorporation: string };
  const persons = deps.db.select().from(casePersons).where(eq(casePersons.caseId, c.id)).all();
  const inputs: CompanyInputs = {
    type: "company",
    country_of_incorporation: company.countryOfIncorporation,
    persons: persons.map((p) => ({ ref: p.id, country_of_residence: p.countryOfResidence, pep: p.pep || pepPersonIds.includes(p.id) })),
  };
  const risk = scoreCompany(
    {
      countryOfIncorporation: inputs.country_of_incorporation,
      persons: persons.map((p) => ({ id: p.id, name: p.fullName, countryOfResidence: p.countryOfResidence, pep: p.pep || pepPersonIds.includes(p.id) })),
    },
    policy,
    deps.kyb,
  );
  return { risk, threshold: null, engineVersions: versions(deps, policy), policy, inputs: inputs as DecisionInputs };
}

/** Who gets screened: the individual, or the company and every natural person on it (spec 03 item 14). */
async function screenCase(deps: PortalDeps, c: CaseRow) {
  if (c.persona === "company") {
    const company = c.company as { legalName: string; countryOfIncorporation: string };
    const persons = deps.db.select().from(casePersons).where(eq(casePersons.caseId, c.id)).all();
    const subjects = [
      { subject: "company", fullName: company.legalName, dateOfBirth: "", countries: [company.countryOfIncorporation] },
      ...persons.map((p) => ({ subject: p.id, fullName: p.fullName, dateOfBirth: p.dateOfBirth, countries: [...new Set([p.nationality, p.countryOfResidence])] })),
    ];
    const results = await Promise.all(subjects.map(async (s) => ({ subject: s.subject, result: await deps.screening.screen(s) })));
    return results;
  }
  const applicant = deps.db.select().from(applicants).where(eq(applicants.id, c.applicantId)).get()!;
  const q = c.questionnaire as QuestionnaireData;
  const r = c.residence as ResidenceData;
  const result = await deps.screening.screen({ fullName: `${applicant.firstName} ${applicant.lastName}`, dateOfBirth: q.dateOfBirth, countries: [...new Set([q.nationality, r.country])] });
  return [{ subject: null as string | null, result }];
}

/** 2.1.7 Submit: the rules engine scores the case and screening runs; it lands in the analyst queue whatever the result. */
export async function submitCase(deps: PortalDeps, c: CaseRow) {
  assertEditable(c, "check");
  const now = deps.now();
  const { risk, threshold, engineVersions, policy, inputs } = scoreCase(deps, c);
  const screenings = await screenCase(deps, c);

  deps.db.transaction((tx) => {
    tx.update(cases)
      .set({ status: "submitted", submittedAt: now.toISOString(), riskResult: risk, thresholdResult: threshold, engineVersions, updatedAt: now.toISOString() })
      .where(eq(cases.id, c.id))
      .run();
    for (const { subject, result } of screenings)
      for (const h of result.hits)
        tx.insert(screeningHits)
          .values({ id: newId(), caseId: c.id, subject, provider: result.provider, listVersion: result.listVersion, entryId: h.entryId, entryName: h.entryName, category: h.category, program: h.program, match: h.match, strength: h.strength, status: "open", createdAt: now.toISOString() })
          .run();
  });
  appendRecord(deps, { subject: c.id, kind: "engine.score", policy, inputs, decided_by: "engine" });
  const first = screenings[0]?.result;
  audit(deps.db, now, `applicant:${c.applicantId}`, "case.submitted", `case:${c.id}`);
  audit(deps.db, now, "engine", "engine.scored", `case:${c.id}`, { risk, threshold, engineVersions });
  audit(deps.db, now, "system", "screening.completed", `case:${c.id}`, {
    provider: first?.provider,
    listVersion: first?.listVersion,
    subjects: screenings.length,
    hits: screenings.reduce((n, s) => n + s.result.hits.length, 0),
  });
}
