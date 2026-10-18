// Applicant journey after email verification (spec 01: 2.1.3 - 2.1.7). Pure; no I/O.
// Individuals and companies share the shape; companies add company, persons and documents (spec 03).

const STEP = {
  overview: { id: "overview", flowId: "2.1.3", title: "Overview", path: "/apply/overview" },
  company: { id: "company", flowId: "2.1.4", title: "Company", path: "/apply/company" },
  persons: { id: "persons", flowId: "2.1.4", title: "People", path: "/apply/persons" },
  identity: { id: "identity", flowId: "2.1.4", title: "Proof of identity", path: "/apply/identity" },
  residence: { id: "residence", flowId: "2.1.5", title: "Proof of residence", path: "/apply/residence" },
  questionnaire: { id: "questionnaire", flowId: "2.1.6", title: "Questionnaire", path: "/apply/questionnaire" },
  documents: { id: "documents", flowId: "2.1.4", title: "Company documents", path: "/apply/documents" },
  check: { id: "check", flowId: "2.1.7", title: "Check", path: "/apply/status" },
} as const;

export type StepId = keyof typeof STEP;
export type Persona = "individual" | "company";

export const STEPS_BY_PERSONA: Record<Persona, readonly (typeof STEP)[StepId][]> = {
  individual: [STEP.overview, STEP.identity, STEP.residence, STEP.questionnaire, STEP.check],
  company: [STEP.overview, STEP.company, STEP.persons, STEP.identity, STEP.residence, STEP.documents, STEP.check],
};

export type StepCase = {
  persona?: Persona;
  status: string;
  overviewSeenAt: string | null;
  identity: { complete?: boolean } | null;
  residence: { complete?: boolean } | null;
  questionnaire: { complete?: boolean } | null;
  company?: { complete?: boolean } | null;
  persons?: { complete?: boolean } | null;
  companyDocs?: { complete?: boolean } | null;
};

export const stepsFor = (c: Pick<StepCase, "persona">) => STEPS_BY_PERSONA[c.persona ?? "individual"];

export function completedSteps(c: StepCase): Record<StepId, boolean> {
  return {
    overview: c.overviewSeenAt !== null,
    company: c.company?.complete === true,
    persons: c.persons?.complete === true,
    identity: c.identity?.complete === true,
    residence: c.residence?.complete === true,
    questionnaire: c.questionnaire?.complete === true,
    documents: c.companyDocs?.complete === true,
    check: c.status !== "draft",
  };
}

/** Where a returning applicant resumes (spec 01: every step is resumable). */
export function resumeStep(c: StepCase): StepId {
  const done = completedSteps(c);
  return stepsFor(c).find((s) => !done[s.id])?.id ?? "check";
}

/** Draft cases may open any completed step and the first incomplete one; submitted cases only the status page. */
export function canOpen(step: StepId, c: StepCase): boolean {
  if (c.status !== "draft") return step === "check";
  const steps = stepsFor(c);
  const idx = (id: StepId) => steps.findIndex((s) => s.id === id);
  return idx(step) >= 0 && idx(step) <= idx(resumeStep(c));
}

export const stepPath = (id: StepId) => STEP[id].path;

/** The step after `step` for this persona (where "Save and continue" goes). */
export function nextStep(step: StepId, c: Pick<StepCase, "persona">): StepId {
  const steps = stepsFor(c);
  return steps[steps.findIndex((s) => s.id === step) + 1]?.id ?? "check";
}
