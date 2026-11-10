import type { PortalDeps } from "@/portal/deps";
import { interviewer1 } from "./interviewer-1";

// One prompt per version (config/agent.yaml interviewer.prompt_version). A version is never edited once it has recordings.

const PROMPTS = { "interviewer-1": interviewer1 } as const;
export const PROMPT_VERSIONS = Object.keys(PROMPTS);

export function interviewerPrompt(version: string, deps: Pick<PortalDeps, "agent" | "portal">): string {
  const build = PROMPTS[version as keyof typeof PROMPTS];
  if (!build) throw new Error(`No interviewer prompt for version ${version}`);
  return build({ deflection: deps.agent.interviewer.deflection, languages: deps.portal.questionnaire.preferred_languages.map((l) => l.label) });
}
