import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applicants, auditLog, cases, documents, settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { checkRulesFromConfig } from "@/documents/factory";
import type { PreReviewDeps } from "@/documents/pre-review";
import { loadPersonas } from "@/demo/personas";
import {
  companyPrefill,
  demoChoices,
  demoCompanyDocuments,
  demoSubject,
  demoUpload,
  getDemoState,
  identityOf,
  nextSamplePerson,
  questionnairePrefill,
  representativePrefill,
  residenceOf,
  sampleFile,
  setDemoState,
  signupDefaults,
  SAMPLE_SLOTS,
  subjectById,
} from "@/demo/prefill";
import { resetDemo } from "@/demo/seed";
import { createAccount, verifyOtp } from "@/portal/accounts";
import { confirmPersons, saveCompany, saveCompanyDocuments, savePerson } from "@/portal/company";
import { getCurrentCase, markOverviewSeen, saveIdentity, saveQuestionnaire, saveResidence, submitCase } from "@/portal/cases";
import { PortalError } from "@/portal/errors";
import { residencePrefill } from "@/portal/evidence";
import { presentFromTestWallet } from "@/portal/wallet";
import type { IdentityData } from "@/portal/cases";
import { residenceFormProps } from "@/app/apply/_forms/props";
import { makeDeps } from "../portal/helpers";

const personas = loadPersonas();
const setup = () => {
  const t = makeDeps();
  setDemoState(t.deps, { on: true }, "analyst-1");
  return t;
};

/** What the browser posts for a form that was rendered from `saved`: booleans become yes/no or on, strings stay. */
function posted(saved: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(saved)) {
    if (val === true) out[k] = k === "pep" || k === "usTaxResident" ? "yes" : "on";
    else if (val === false) {
      if (k === "pep" || k === "usTaxResident") out[k] = "no";
    } else out[k] = val;
  }
  return out;
}

async function signUp(t: ReturnType<typeof setup>) {
  const d = signupDefaults(t.deps)!;
  await createAccount(t.deps, d);
  verifyOtp(t.deps, d.email, { code: t.lastCode() });
  const applicant = t.deps.db.select().from(applicants).where(eq(applicants.email, d.email)).get()!;
  return { applicant, current: () => getCurrentCase(t.deps, applicant.id), defaults: d };
}

describe("Demo Mode state", () => {
  it("is off by default and the console switch is audited, with the sample applicant", () => {
    const t = makeDeps();
    expect(getDemoState(t.deps)).toMatchObject({ on: false, persona: personas.individuals[0]!.id });
    setDemoState(t.deps, { on: true, persona: "medium" }, "analyst-1");
    expect(getDemoState(t.deps)).toEqual({ on: true, persona: "medium" });
    const rows = t.deps.db.select().from(auditLog).all().filter((a) => a.action === "demo_mode.changed");
    expect(rows).toEqual([expect.objectContaining({ actor: "analyst:analyst-1", payload: { from: { on: false, persona: "low" }, to: { on: true, persona: "medium" } } })]);
  });

  it("writes nothing when nothing changes, and rejects an unknown persona", () => {
    const t = setup();
    const before = t.deps.db.select().from(auditLog).all().length;
    setDemoState(t.deps, { on: true }, "analyst-1");
    expect(t.deps.db.select().from(auditLog).all()).toHaveLength(before);
    expect(() => setDemoState(t.deps, { persona: "nobody" }, "analyst-1")).toThrow(PortalError);
  });

  it("offers every seeded persona, individuals first and the company last", () => {
    expect(demoChoices().map((c) => c.id)).toEqual([...personas.individuals.map((p) => p.id), personas.company.id]);
    expect(demoChoices().at(-1)!.kind).toBe("company");
  });

  it("survives a demo reset, which is a presentation setting", async () => {
    const t = makeDeps();
    setDemoState(t.deps, { on: true, persona: "high" }, "analyst-1");
    const d: PreReviewDeps = { ...t.deps, checkRules: checkRulesFromConfig(), documentReader: () => { throw new Error("Claude is skipped in this test"); } };
    await resetDemo(d, { claude: "skip", actor: "cli" });
    expect(getDemoState(d)).toEqual({ on: true, persona: "high" });
  });
});

describe("Demo Mode applicant binding", () => {
  it("is off for everyone when the switch is off", async () => {
    const t = makeDeps();
    expect(signupDefaults(t.deps)).toBeNull();
    expect(demoSubject(t.deps, "anyone")).toBeNull();
    await createAccount(t.deps, { persona: "individual", firstName: "A", lastName: "B", email: "a.b@example.test" });
    const c = getCurrentCase(t.deps, t.deps.db.select().from(applicants).get()!.id);
    expect(sampleFile(t.deps, c, "front")).toBeUndefined();
    expect(demoUpload(t.deps, c, "front")).toBeUndefined();
  });

  it("gives every click-through a fresh email, so seeded personas are never signed in by accident", async () => {
    const t = setup();
    const first = await signUp(t);
    expect(first.defaults.email).toBe("ada.sample.1@demo.test");
    expect(signupDefaults(t.deps)!.email).toBe("ada.sample.2@demo.test");
    expect(first.defaults).toMatchObject({ persona: "individual", firstName: "Ada", lastName: "Sample" });
  });

  it("keeps an application on the persona it started with when the console picks another", async () => {
    const t = setup();
    const a = await signUp(t);
    expect(demoSubject(t.deps, a.applicant.id)!.id).toBe("low");
    setDemoState(t.deps, { persona: "prohibited" }, "analyst-1");
    expect(demoSubject(t.deps, a.applicant.id)!.id).toBe("low");
    const b = await signUp(t);
    expect(demoSubject(t.deps, b.applicant.id)!.id).toBe("prohibited");
  });

  it("starts the company persona as a company account with the representative's name", () => {
    const t = setup();
    setDemoState(t.deps, { persona: "company" }, "analyst-1");
    expect(signupDefaults(t.deps)).toMatchObject({ persona: "company", firstName: "Ada", email: "ada.sample.company.1@demo.test" });
  });
});

describe("Demo Mode samples", () => {
  it("has a sample file for every slot of every persona", async () => {
    for (const choice of demoChoices()) {
      const t = setup();
      setDemoState(t.deps, { persona: choice.id }, "analyst-1");
      const a = await signUp(t);
      const c = a.current();
      for (const slot of SAMPLE_SLOTS) {
        const f = sampleFile(t.deps, c, slot);
        const personSlot = slot === "person_poi" || slot === "person_por";
        if (personSlot && choice.kind === "individual") expect(f, `${choice.id} ${slot}`).toBeUndefined();
        else expect(f?.size, `${choice.id} ${slot}`).toBeGreaterThan(0);
      }
    }
  });

  it("attaches the persona's own passport and proof of residence, the shared selfie and a bank statement", async () => {
    const bytes = (rel: string) => fs.readFileSync(path.resolve("fixtures", rel));
    for (const id of ["low", "high", "prohibited"]) {
      const t = setup();
      setDemoState(t.deps, { persona: id }, "analyst-1");
      const c = (await signUp(t)).current();
      expect(sampleFile(t.deps, c, "front")!.bytes.equals(bytes(`personas/${id}-poi.png`))).toBe(true);
      expect(sampleFile(t.deps, c, "por")!.bytes.equals(bytes(`personas/${id}-por.png`))).toBe(true);
      expect(sampleFile(t.deps, c, "selfie")!.bytes.equals(bytes("personas/selfie.png"))).toBe(true);
      expect(sampleFile(t.deps, c, "sof")!.bytes.equals(bytes("documents/por-valid-bank.png"))).toBe(true);
    }
  });

  it("never replaces a document that is already on file", async () => {
    const t = setup();
    const a = await signUp(t);
    markOverviewSeen(t.deps, a.current());
    expect(demoUpload(t.deps, a.current(), "front")).toBeDefined();
    await saveIdentity(t.deps, a.current(), identityOf(subjectById("low")!.rep), { front: demoUpload(t.deps, a.current(), "front"), selfie: demoUpload(t.deps, a.current(), "selfie") });
    expect(demoUpload(t.deps, a.current(), "front")).toBeUndefined();
    expect(demoUpload(t.deps, a.current(), "selfie")).toBeUndefined();
    // The preview of a sample (what the screen shows) does not care what is on file.
    expect(sampleFile(t.deps, a.current(), "front")).toBeDefined();
  });

  it("on the wallet route keeps the wallet's address and adds the document type, so Continue saves", async () => {
    const t = setup();
    const a = await signUp(t);
    markOverviewSeen(t.deps, a.current());
    presentFromTestWallet(t.deps, a.current(), "valid");
    const wallet = residencePrefill(a.current().identity as IdentityData)!;
    const saved = residenceFormProps(t.deps, a.current()).form.saved as Record<string, string>;
    expect(saved).toMatchObject(wallet);
    expect(saved.porType).toBe(residenceOf(subjectById("low")!.rep).porType);
    await saveResidence(t.deps, a.current(), posted(saved), { por: demoUpload(t.deps, a.current(), "por") });
    expect(a.current().residence).toMatchObject(wallet);
  });

  it("prefills the questionnaire the way the form reads saved answers", () => {
    const t = setup();
    const pre = questionnairePrefill(t.deps, subjectById("high")!);
    expect(pre).toMatchObject({ pep: true, usTaxResident: false, declaration: true, onlySourceOfWealth: false, preferredLanguage: "en", nationality: "GR" });
    expect(posted(pre)).toMatchObject({ pep: "yes", usTaxResident: "no", declaration: "on" });
  });
});

describe("Demo Mode click-through reaches the seeded outcome", () => {
  for (const p of personas.individuals) {
    it(`individual "${p.id}": only pre-filled screens and sample files, ends in the ${p.expect.band} band`, async () => {
      const t = setup();
      setDemoState(t.deps, { persona: p.id }, "analyst-1");
      const a = await signUp(t);
      const s = demoSubject(t.deps, a.applicant.id)!;
      markOverviewSeen(t.deps, a.current());
      await saveIdentity(t.deps, a.current(), identityOf(s.rep), { front: demoUpload(t.deps, a.current(), "front"), selfie: demoUpload(t.deps, a.current(), "selfie") });
      await saveResidence(t.deps, a.current(), residenceOf(s.rep), { por: demoUpload(t.deps, a.current(), "por") });
      saveQuestionnaire(t.deps, a.current(), posted(questionnairePrefill(t.deps, s)));
      await submitCase(t.deps, a.current());
      const c = a.current();
      expect(c.status).toBe("submitted");
      expect((c.riskResult as { band: string }).band).toBe(p.expect.band);
      expect(t.deps.db.select().from(documents).where(eq(documents.caseId, c.id)).all().map((d) => d.kind).sort()).toEqual(["por", "poi_front", "selfie"].sort());
    });
  }

  it("company: company form, people (with their sample IDs), identity, residence and the document pack", async () => {
    const t = setup();
    setDemoState(t.deps, { persona: "company" }, "analyst-1");
    const a = await signUp(t);
    const s = demoSubject(t.deps, a.applicant.id)!;
    markOverviewSeen(t.deps, a.current());
    saveCompany(t.deps, a.current(), posted(companyPrefill(s)!));
    await savePerson(t.deps, a.current(), { ...posted(representativePrefill(s)!) }, {}, { isApplicant: true });
    for (let next = nextSamplePerson(t.deps, a.current().id, s); next; next = nextSamplePerson(t.deps, a.current().id, s))
      await savePerson(t.deps, a.current(), posted(next.prefill), { poi: demoUpload(t.deps, a.current(), "person_poi"), por: demoUpload(t.deps, a.current(), "person_por") });
    confirmPersons(t.deps, a.current());
    await saveIdentity(t.deps, a.current(), identityOf(s.rep), { front: demoUpload(t.deps, a.current(), "front"), selfie: demoUpload(t.deps, a.current(), "selfie") });
    await saveResidence(t.deps, a.current(), residenceOf(s.rep), { por: demoUpload(t.deps, a.current(), "por") });
    const pack = demoCompanyDocuments(t.deps, a.current());
    expect(Object.keys(pack).sort()).toEqual(Object.keys(s.company!.documents).sort());
    await saveCompanyDocuments(t.deps, a.current(), pack, { finish: true });
    expect(demoCompanyDocuments(t.deps, a.current())).toEqual({});
    await submitCase(t.deps, a.current());
    expect((a.current().riskResult as { band: string }).band).toBe(personas.company.expect.band);
  });

  it("matches the seeder: same band as the seeded persona for every individual", async () => {
    const t = makeDeps();
    const d: PreReviewDeps = { ...t.deps, checkRules: checkRulesFromConfig(), documentReader: () => { throw new Error("Claude is skipped in this test"); } };
    const seeded = await resetDemo(d, { claude: "skip", actor: "cli" });
    expect(seeded.cases.map((c) => c.band)).toEqual([...personas.individuals.map((p) => p.expect.band), personas.company.expect.band]);
    expect(d.db.select().from(cases).all()).toHaveLength(personas.individuals.length + 1);
    expect(d.db.select().from(settings).all().filter((r) => r.key.startsWith("demo."))).toEqual([]);
  });
});
