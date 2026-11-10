import { and, eq, isNull } from "drizzle-orm";
import { applicants, casePersons, documents, settings } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { CaseRow, UploadInput } from "@/portal/cases";
import type { PortalDeps } from "@/portal/deps";
import { PortalError } from "@/portal/errors";
import { questionnaireSchema } from "@/portal/schemas";
import { fixtureUpload, loadPersonas, type IndividualPersona, type Personas } from "./personas";

// Demo Mode (docs/spec/11): the analyst console switches it on, and every apply screen is then pre-filled
// from a synthetic persona, with the persona's SAMPLE documents attached on the server. It only fills in
// what an applicant would type or upload. Nothing here touches the engine, and the applicant still
// presses Continue on every screen.

export const DEMO_ON_KEY = "demo.on";
export const DEMO_PERSONA_KEY = "demo.persona";
export const DEMO_KEYS = [DEMO_ON_KEY, DEMO_PERSONA_KEY] as const;
const boundKey = (applicantId: string) => `demo.applicant.${applicantId}`;

export type DemoState = { on: boolean; persona: string };
export type DemoChoice = { id: string; kind: "individual" | "company"; name: string; story: string };
export type DemoSubject = { id: string; kind: "individual" | "company"; rep: IndividualPersona; company?: Personas["company"] };
export type SampleSlot = "front" | "selfie" | "por" | "sof" | "eddKyc" | "person_poi" | "person_por";
export const SAMPLE_SLOTS: readonly SampleSlot[] = ["front", "selfie", "por", "sof", "eddKyc", "person_poi", "person_por"];

const SAMPLE_WHAT: Record<SampleSlot, string> = { front: "passport", selfie: "selfie", por: "proof of residence", sof: "bank statement", eddKyc: "ID-holding photo", person_poi: "ID", person_por: "proof of residence" };

/** Synthetic sample documents that are not persona-specific: a bank statement stands in for proof of source of funds. */
const SOF_SAMPLE = "../documents/por-valid-bank.png";
const SELFIE_SAMPLE = "selfie.png";
const DEMO_EMAIL_DOMAIN = "demo.test";

// Same values the seeder submits, so a click-through lands where the seeded persona lands.
export const identityOf = (p: IndividualPersona) => ({ docType: "passport", issuingCountry: p.nationality, expiryDate: "2031-03-14" });
const RESIDENCE_EXTRAS = { porType: "utility_bill", mobilePhone: "+31 6 0000 0000" };
export const residenceOf = (p: IndividualPersona) => ({ ...p.address, ...RESIDENCE_EXTRAS });
/** Wallet route (O-96): the address the ID wallet carried stays; Demo Mode adds the document type and phone, so Continue still works. */
export const withResidenceExtras = (walletAddress: Record<string, string>) => ({ ...RESIDENCE_EXTRAS, ...walletAddress });
export const questionnaireInput = (p: IndividualPersona) => ({
  dateOfBirth: p.dob,
  nationality: p.nationality,
  preferredLanguage: "en",
  phone: "+31 6 0000 0000",
  tin: `SAMPLE-TIN-${p.id.toUpperCase()}`,
  declaration: "on",
  ...p.answers,
});

export function demoChoices(): DemoChoice[] {
  const personas = loadPersonas();
  return [
    ...personas.individuals.map((p) => ({ id: p.id, kind: "individual" as const, name: `${p.first} ${p.last}`, story: p.story })),
    { id: personas.company.id, kind: "company" as const, name: String(personas.company.company.legalName), story: personas.company.story },
  ];
}

export function subjectById(id: string): DemoSubject | null {
  const personas = loadPersonas();
  const individual = personas.individuals.find((p) => p.id === id);
  if (individual) return { id, kind: "individual", rep: individual };
  if (id === personas.company.id) {
    const rep = personas.individuals.find((p) => p.id === personas.company.representative.personaId);
    return rep ? { id, kind: "company", rep, company: personas.company } : null;
  }
  return null;
}

const read = (deps: PortalDeps, key: string) => deps.db.select().from(settings).where(eq(settings.key, key)).get()?.value;
function write(deps: PortalDeps, key: string, value: string, by: string) {
  const now = deps.now().toISOString();
  deps.db.insert(settings).values({ key, value, updatedAt: now, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now, updatedBy: by } }).run();
}

export function getDemoState(deps: PortalDeps): DemoState {
  const chosen = read(deps, DEMO_PERSONA_KEY);
  return { on: read(deps, DEMO_ON_KEY) === "1", persona: chosen && subjectById(chosen) ? chosen : demoChoices()[0]!.id };
}

/** Switches Demo Mode and/or picks the sample applicant. Audited when something changes. */
export function setDemoState(deps: PortalDeps, next: { on?: boolean; persona?: string }, analystId: string) {
  if (next.persona !== undefined && !subjectById(next.persona)) throw new PortalError("VALIDATION", "Choose a sample applicant from the list.");
  const from = getDemoState(deps);
  const to = { on: next.on ?? from.on, persona: next.persona ?? from.persona };
  if (to.on === from.on && to.persona === from.persona) return;
  const by = `analyst:${analystId}`;
  write(deps, DEMO_ON_KEY, to.on ? "1" : "0", by);
  write(deps, DEMO_PERSONA_KEY, to.persona, by);
  audit(deps.db, deps.now(), by as `analyst:${string}`, "demo_mode.changed", null, { from, to });
}

/**
 * The sample applicant a signed-in applicant follows. Bound on first use, so switching the persona in the
 * console later does not change an application that is already under way. Null when Demo Mode is off.
 */
export function demoSubject(deps: PortalDeps, applicantId: string): DemoSubject | null {
  const state = getDemoState(deps);
  if (!state.on) return null;
  const bound = read(deps, boundKey(applicantId));
  const existing = bound ? subjectById(bound) : null;
  if (existing) return existing;
  write(deps, boundKey(applicantId), state.persona, "system");
  return subjectById(state.persona);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Values for the create-account screen. The email is made unique, so every click-through starts a new application. */
export function signupDefaults(deps: PortalDeps): { persona: "individual" | "company"; firstName: string; lastName: string; email: string } | null {
  const state = getDemoState(deps);
  if (!state.on) return null;
  const s = subjectById(state.persona)!;
  const base = `${slug(s.rep.first)}.${slug(s.rep.last)}${s.kind === "company" ? ".company" : ""}`;
  const taken = new Set(deps.db.select({ email: applicants.email }).from(applicants).all().map((r) => r.email));
  let n = 1;
  while (taken.has(`${base}.${n}@${DEMO_EMAIL_DOMAIN}`)) n++;
  return { persona: s.kind, firstName: s.rep.first, lastName: s.rep.last, email: `${base}.${n}@${DEMO_EMAIL_DOMAIN}` };
}

/** The questionnaire as the form reads saved answers (yes/no and checkboxes as booleans): the parsed form of what the seeder submits. */
export function questionnairePrefill(deps: PortalDeps, s: DemoSubject): Record<string, unknown> {
  const input = questionnaireInput(s.rep);
  const parsed = questionnaireSchema(deps.engine, deps.portal, deps.now().toISOString().slice(0, "yyyy-mm-dd".length)).safeParse(input);
  return parsed.success ? parsed.data : input;
}

export const companyPrefill = (s: DemoSubject): Record<string, unknown> | null => (s.company ? { ...s.company.company, declaration: true } : null);

const personPrefill = (p: { fullName: string; dob: string; nationality: string; countryOfResidence: string; roles: string[]; share: string }) => ({
  fullName: p.fullName,
  dateOfBirth: p.dob,
  nationality: p.nationality,
  countryOfResidence: p.countryOfResidence,
  roles: p.roles,
  sharePercent: p.share,
  pep: false,
});

export const representativePrefill = (s: DemoSubject): Record<string, unknown> | null =>
  s.company
    ? personPrefill({ fullName: `${s.rep.first} ${s.rep.last}`, dob: s.rep.dob, nationality: s.rep.nationality, countryOfResidence: s.rep.address.country, roles: s.company.representativeRoles, share: s.company.representativeShare })
    : null;

/** The next sample person to add (company flow): the first one not on the people list yet. */
export function nextSamplePerson(deps: PortalDeps, caseId: string, s: DemoSubject): { id: string; prefill: Record<string, unknown> } | null {
  if (!s.company) return null;
  const listed = new Set(deps.db.select({ name: casePersons.fullName }).from(casePersons).where(eq(casePersons.caseId, caseId)).all().map((r) => r.name));
  const o = s.company.others.find((x) => !listed.has(x.fullName));
  return o ? { id: o.id, prefill: personPrefill({ fullName: o.fullName, dob: o.dob, nationality: o.nationality, countryOfResidence: o.address.country, roles: o.roles, share: o.share }) } : null;
}

type DocKind = (typeof documents.$inferSelect)["kind"];
const onFile = (deps: PortalDeps, caseId: string, kind: DocKind) =>
  !!deps.db.select({ id: documents.id }).from(documents).where(and(eq(documents.caseId, caseId), eq(documents.kind, kind), isNull(documents.supersededAt))).get();
const SLOT_KIND: Partial<Record<SampleSlot, DocKind>> = { front: "poi_front", selfie: "selfie", por: "por" };

/** The sample file for a slot, or undefined when Demo Mode is off or the persona has none for it. Ignores what is already on file. */
export function sampleFile(deps: PortalDeps, c: Pick<CaseRow, "id" | "applicantId">, slot: SampleSlot): UploadInput | undefined {
  const s = demoSubject(deps, c.applicantId);
  if (!s) return undefined;
  switch (slot) {
    case "front": return fixtureUpload(`${s.rep.id}-poi.png`);
    case "selfie":
    case "eddKyc": return fixtureUpload(SELFIE_SAMPLE);
    case "por": return fixtureUpload(`${s.rep.id}-por.png`);
    case "sof": return fixtureUpload(SOF_SAMPLE);
    case "person_poi":
    case "person_por": {
      const next = nextSamplePerson(deps, c.id, s);
      return next ? fixtureUpload(`${next.id}-${slot === "person_poi" ? "poi" : "por"}.png`) : undefined;
    }
  }
}

/** What a server action should submit when the applicant chose no file: the sample, unless a document is already on file for the slot. */
export function demoUpload(deps: PortalDeps, c: Pick<CaseRow, "id" | "applicantId">, slot: SampleSlot): UploadInput | undefined {
  const kind = SLOT_KIND[slot];
  if (kind && onFile(deps, c.id, kind)) return undefined;
  return sampleFile(deps, c, slot);
}

/** What a screen shows as "attached": the slot and file name, when a sample would be sent for it. */
export function demoSampleInfo(deps: PortalDeps, c: Pick<CaseRow, "id" | "applicantId">, slot: SampleSlot): { slot: SampleSlot; name: string; what: string } | undefined {
  const f = demoUpload(deps, c, slot);
  return f ? { slot, name: f.name, what: SAMPLE_WHAT[slot] } : undefined;
}

/** Company document pack: a sample for each checklist item the persona has one for and that has none yet. */
export function demoCompanyDocuments(deps: PortalDeps, c: Pick<CaseRow, "id" | "applicantId">): Record<string, UploadInput[]> {
  const s = demoSubject(deps, c.applicantId);
  if (!s?.company) return {};
  const tagged = new Set(deps.db.select({ t: documents.docType }).from(documents).where(and(eq(documents.caseId, c.id), eq(documents.kind, "company_doc"), isNull(documents.supersededAt))).all().map((r) => r.t));
  return Object.fromEntries(Object.entries(s.company.documents).filter(([item]) => !tagged.has(item)).map(([item, file]) => [item, [fixtureUpload(file)]]));
}
