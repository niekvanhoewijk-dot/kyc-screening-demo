import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionApplicant } from "@/portal/accounts";
import { getCurrentCase, stepCase } from "@/portal/cases";
import { portalDeps } from "@/portal/deps";
import { canOpen, resumeStep, stepPath, type StepId } from "@/portal/steps";

export const SESSION_COOKIE = "kyc_session";
export const PENDING_EMAIL_COOKIE = "kyc_pending_email";

export const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: maxAgeSeconds,
});

export async function currentApplicant() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionApplicant(portalDeps(), token);
}

/** Guards a step page: signed in, and the step is open for this case; otherwise redirects to where they belong. */
export async function requireStep(step: StepId) {
  const applicant = await currentApplicant();
  if (!applicant) redirect("/apply/continue");
  const deps = portalDeps();
  const c = getCurrentCase(deps, applicant.id);
  if (!canOpen(step, stepCase(c))) redirect(stepPath(resumeStep(stepCase(c))));
  return { deps, applicant, c };
}
