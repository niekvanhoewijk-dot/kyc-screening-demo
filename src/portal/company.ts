import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { casePersons, cases, documents } from "@/db/schema";
import { uploadableItems, type PersonRole } from "@/engine";
import { audit } from "@/lib/audit";
import { isCountryCode } from "@/lib/countries";
import { newId } from "@/lib/ids";
import { assertEditable, checkUpload, storeDoc, type CaseRow, type UploadInput } from "./cases";
import type { PortalDeps } from "./deps";
import { PortalError, type FieldErrors } from "./errors";
import { OTHER_OCCUPATION, parseOrThrow } from "./schemas";

// Company KYB steps (docs/spec/03). The representative uses the portal and provides the documents
// for every natural person (O-31); only the representative takes a selfie.

const required = (label: string) => z.string().trim().min(1, `${label} is required`);
const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));
const country = (label: string) => required(label).refine(isCountryCode, `Choose a valid ${label.toLowerCase()}`);
const oneOf = (ids: string[], label: string) => z.string().refine((v) => ids.includes(v), `Choose a valid ${label.toLowerCase()}`);
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
const PO_BOX = /\b(p\.?\s*o\.?\s*box|post\s*office\s*box|postbus|postfach)\b/i;

export function companySchema(deps: PortalDeps) {
  const f = deps.engine.matrix.factors;
  const ids = (l: { id: string }[]) => l.map((v) => v.id);
  return z.object({
    legalName: required("Legal name").max(200),
    registrationNumber: required("Registration number").max(100),
    countryOfIncorporation: country("Country of incorporation"),
    addressLine1: required("Registered address").max(200).refine((v) => !PO_BOX.test(v), "We can't accept a P.O. box as the registered address"),
    city: required("City").max(100),
    postcode: optional,
    addressCountry: country("Address country"),
    // Corporate questionnaire (item 12). The requirements give no corporate form (O-8): these are
    // collected for the analyst and EDD; they are not scored.
    industry: oneOf([...ids(f.occupation_industry.values), OTHER_OCCUPATION.id], "Industry"),
    industryDetail: optional,
    deposit_12m: oneOf(ids(f.deposit_12m), "Expected deposit"),
    source_of_funds: oneOf(ids(f.source_of_funds), "Source of funds"),
    declaration: checkbox.refine((v) => v, "Please confirm the declaration to continue"),
  });
}
export type CompanyData = z.infer<ReturnType<typeof companySchema>> & { complete: boolean };

export function saveCompany(deps: PortalDeps, c: CaseRow, input: unknown) {
  assertEditable(c, "company");
  const data = parseOrThrow(companySchema(deps), input);
  deps.db.update(cases).set({ company: { ...data, complete: true } satisfies CompanyData, updatedAt: deps.now().toISOString() }).where(eq(cases.id, c.id)).run();
  audit(deps.db, deps.now(), `applicant:${c.applicantId}`, "step.completed", `case:${c.id}`, { step: "company" });
}

function personSchema(deps: PortalDeps, today: string) {
  const roles = deps.kyb.person_roles.map((r) => r.id);
  return z
    .object({
      fullName: required("Full name").max(200),
      dateOfBirth: z.iso.date("Date of birth must be a valid date").refine((d) => d < today, "Date of birth must be in the past"),
      nationality: country("Nationality"),
      countryOfResidence: country("Country of residence"),
      roles: z.array(z.enum(roles as [PersonRole, ...PersonRole[]])).min(1, "Choose at least one role"),
      sharePercent: optional,
      pep: z.enum(["yes", "no"], "Please answer: politically exposed person").transform((v) => v === "yes"),
    })
    .superRefine((v, ctx) => {
      if (v.roles.includes("shareholder")) {
        const n = Number(v.sharePercent);
        if (!v.sharePercent || Number.isNaN(n) || n <= 0 || n > deps.kyb.shareholding_total_percent)
          ctx.addIssue({ code: "custom", path: ["sharePercent"], message: `Enter the shareholding in percent (above 0, at most ${deps.kyb.shareholding_total_percent})` });
      }
    });
}

export const personsOf = (deps: PortalDeps, caseId: string) =>
  deps.db.select().from(casePersons).where(eq(casePersons.caseId, caseId)).orderBy(casePersons.createdAt).all();

export function personDocs(deps: PortalDeps, caseId: string) {
  return deps.db
    .select()
    .from(documents)
    .where(and(eq(documents.caseId, caseId), isNull(documents.supersededAt)))
    .all()
    .filter((d) => d.kind === "person_poi" || d.kind === "person_por");
}

/**
 * Adds or updates a person. `isApplicant` is the representative using the portal: their POI, selfie
 * and POR come from the identity and residence steps; everyone else needs POI and POR uploaded here.
 */
export async function savePerson(
  deps: PortalDeps,
  c: CaseRow,
  input: Record<string, unknown>,
  files: { poi?: UploadInput; por?: UploadInput },
  opts: { personId?: string; isApplicant?: boolean } = {},
) {
  assertEditable(c, "persons");
  const errors: FieldErrors = {};
  let data: z.infer<ReturnType<typeof personSchema>> | undefined;
  const roles = Array.isArray(input.roles) ? input.roles : input.roles ? [input.roles] : [];
  try {
    data = parseOrThrow(personSchema(deps, deps.now().toISOString().slice(0, "yyyy-mm-dd".length)), { ...input, roles });
  } catch (e) {
    if (!(e instanceof PortalError)) throw e;
    Object.assign(errors, e.fieldErrors);
  }
  const existing = opts.personId ? personsOf(deps, c.id).find((p) => p.id === opts.personId) : undefined;
  if (opts.personId && !existing) throw new PortalError("NOT_FOUND", "Person not found.");
  const isApplicant = existing?.isApplicant ?? opts.isApplicant ?? false;
  if (isApplicant && data && !data.roles.includes("representative")) errors.roles = ["You are the representative; keep that role selected"];

  const mimes = deps.portal.uploads.document_mime;
  const poi = isApplicant ? undefined : checkUpload(deps, "poi", files.poi, mimes, errors);
  const por = isApplicant ? undefined : checkUpload(deps, "por", files.por, mimes, errors);
  const have = (kind: "person_poi" | "person_por") => !!existing && personDocs(deps, c.id).some((d) => d.personId === existing.id && d.kind === kind);
  if (!isApplicant && !poi && !have("person_poi")) errors.poi ??= ["Upload this person's passport, ID card or driving licence"];
  if (!isApplicant && !por && !have("person_por")) errors.por ??= ["Upload this person's proof of residence"];
  if (!data || Object.keys(errors).length) throw new PortalError("VALIDATION", "Please check the highlighted fields.", errors);

  const id = existing?.id ?? newId();
  const row = {
    fullName: data.fullName,
    dateOfBirth: data.dateOfBirth,
    nationality: data.nationality,
    countryOfResidence: data.countryOfResidence,
    roles: data.roles,
    sharePercent: data.roles.includes("shareholder") ? String(Number(data.sharePercent)) : null,
    pep: data.pep,
  };
  if (existing) deps.db.update(casePersons).set(row).where(eq(casePersons.id, id)).run();
  else deps.db.insert(casePersons).values({ id, caseId: c.id, isApplicant, createdAt: deps.now().toISOString(), ...row }).run();

  const docRow = { ...c, applicantId: c.applicantId };
  if (poi) await storeDoc(deps, docRow, "person_poi", poi, null, { personId: id });
  if (por) await storeDoc(deps, docRow, "person_por", por, null, { personId: id });
  deps.db.update(cases).set({ persons: null, updatedAt: deps.now().toISOString() }).where(eq(cases.id, c.id)).run(); // re-confirm the list after any change
  audit(deps.db, deps.now(), `applicant:${c.applicantId}`, existing ? "person.updated" : "person.added", `case:${c.id}`, { personId: id, roles: data.roles });
  return id;
}

export function removePerson(deps: PortalDeps, c: CaseRow, personId: string) {
  assertEditable(c, "persons");
  const p = personsOf(deps, c.id).find((x) => x.id === personId);
  if (!p) throw new PortalError("NOT_FOUND", "Person not found.");
  if (p.isApplicant) throw new PortalError("VALIDATION", "You can't remove yourself: you are the representative.");
  const now = deps.now().toISOString();
  deps.db.transaction((tx) => {
    tx.update(documents).set({ supersededAt: now }).where(and(eq(documents.caseId, c.id), eq(documents.personId, personId))).run();
    tx.delete(casePersons).where(eq(casePersons.id, personId)).run();
    tx.update(cases).set({ persons: null, updatedAt: now }).where(eq(cases.id, c.id)).run();
  });
  audit(deps.db, deps.now(), `applicant:${c.applicantId}`, "person.removed", `case:${c.id}`, { personId });
}

/** Confirms the people list. Required roles must be covered (spec 03); other gaps go to the analyst's gap list. */
export function confirmPersons(deps: PortalDeps, c: CaseRow) {
  assertEditable(c, "persons");
  const persons = personsOf(deps, c.id);
  if (!persons.some((p) => p.isApplicant)) throw new PortalError("VALIDATION", "Tell us about yourself first.");
  const missing = deps.kyb.required_roles.filter((r) => !persons.some((p) => (p.roles as string[]).includes(r)));
  if (missing.length) {
    const label = (r: string) => deps.kyb.person_roles.find((x) => x.id === r)?.label ?? r;
    throw new PortalError("VALIDATION", `Add at least one: ${missing.map(label).join(", ")}.`);
  }
  deps.db.update(cases).set({ persons: { complete: true, count: persons.length }, updatedAt: deps.now().toISOString() }).where(eq(cases.id, c.id)).run();
  audit(deps.db, deps.now(), `applicant:${c.applicantId}`, "step.completed", `case:${c.id}`, { step: "persons", persons: persons.length });
}

/** Company documents (items 3-13). Uploads are tagged with the checklist item they were given for. */
export async function saveCompanyDocuments(deps: PortalDeps, c: CaseRow, files: Record<string, UploadInput[]>, opts: { finish: boolean }) {
  assertEditable(c, "documents");
  const items = new Set([...uploadableItems(deps.kyb).map((i) => i.id), "unsorted"]);
  const errors: FieldErrors = {};
  const accepted: [string, UploadInput][] = [];
  for (const [item, list] of Object.entries(files)) {
    if (!items.has(item)) continue;
    for (const f of list.filter((x) => x.size > 0)) if (checkUpload(deps, `doc_${item}`, f, deps.portal.uploads.document_mime, errors)) accepted.push([item, f]);
  }
  if (Object.keys(errors).length) throw new PortalError("VALIDATION", "Please check the highlighted files.", errors);
  for (const [item, f] of accepted) await storeDoc(deps, c, "company_doc", f, item === "unsorted" ? null : item, { keepPrevious: true });
  if (opts.finish) {
    deps.db.update(cases).set({ companyDocs: { complete: true }, updatedAt: deps.now().toISOString() }).where(eq(cases.id, c.id)).run();
    audit(deps.db, deps.now(), `applicant:${c.applicantId}`, "step.completed", `case:${c.id}`, { step: "documents" });
  }
}

export function companyDocuments(deps: PortalDeps, caseId: string) {
  return deps.db
    .select()
    .from(documents)
    .where(and(eq(documents.caseId, caseId), eq(documents.kind, "company_doc"), isNull(documents.supersededAt)))
    .all();
}

/** Checklist items with no document tagged for them yet (shown to the applicant; the analyst sees the full gap list). */
export function missingItems(deps: PortalDeps, caseId: string) {
  const tagged = new Set(companyDocuments(deps, caseId).map((d) => d.docType));
  return uploadableItems(deps.kyb).filter((i) => !tagged.has(i.id));
}
