import { redirect } from "next/navigation";
import { ApplicantShell } from "@/components/applicant-shell";
import { portalDeps } from "@/portal/deps";
import { getCurrentCase, stepCase } from "@/portal/cases";
import { resumeStep, stepPath } from "@/portal/steps";
import { CreateAccountForm } from "./_forms/account-forms";
import { currentApplicant } from "./session";

// 2.1.1 Create account (docs/design/Main.dc.html)
export default async function ApplyPage() {
  const applicant = await currentApplicant();
  if (applicant) redirect(stepPath(resumeStep(stepCase(getCurrentCase(portalDeps(), applicant.id)))));
  return (
    <ApplicantShell
      panelTitle="Open your account"
      panelBody="A few details first. You can leave at any time and come back exactly where you stopped."
      c={null}
      current="create"
      title="Create your account"
      lede="Tell us who is opening the account. Verification takes about ten minutes and is saved as you go."
      narrow
    >
      <CreateAccountForm />
    </ApplicantShell>
  );
}
