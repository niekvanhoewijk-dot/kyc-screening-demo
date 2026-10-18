// Applicant journey after email verification (spec 01: 2.1.3 - 2.1.7). Pure; no I/O.

export const STEPS = [
  { id: "overview", flowId: "2.1.3", title: "Overview", path: "/apply/overview" },
  { id: "identity", flowId: "2.1.4", title: "Proof of identity", path: "/apply/identity" },
  { id: "residence", flowId: "2.1.5", title: "Proof of residence", path: "/apply/residence" },
  { id: "questionnaire", flowId: "2.1.6", title: "Questionnaire", path: "/apply/questionnaire" },
  { id: "check", flowId: "2.1.7", title: "Check", path: "/apply/status" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export type StepCase = {
  status: string;
  overviewSeenAt: string | null;
  identity: { complete?: boolean } | null;
  residence: { complete?: boolean } | null;
  questionnaire: { complete?: boolean } | null;
};

export function completedSteps(c: StepCase): Record<StepId, boolean> {
  return {
    overview: c.overviewSeenAt !== null,
    identity: c.identity?.complete === true,
    residence: c.residence?.complete === true,
    questionnaire: c.questionnaire?.complete === true,
    check: c.status !== "draft",
  };
}

/** Where a returning applicant resumes (spec 01: every step is resumable). */
export function resumeStep(c: StepCase): StepId {
  const done = completedSteps(c);
  return STEPS.find((s) => !done[s.id])?.id ?? "check";
}

/** Draft cases may open any completed step and the first incomplete one; submitted cases only the status page. */
export function canOpen(step: StepId, c: StepCase): boolean {
  if (c.status !== "draft") return step === "check";
  const idx = (id: StepId) => STEPS.findIndex((s) => s.id === id);
  return idx(step) <= idx(resumeStep(c));
}

export const stepPath = (id: StepId) => STEPS.find((s) => s.id === id)!.path;
