import Link from "next/link";
import { redirect } from "next/navigation";
import { portalDeps } from "@/portal/deps";
import { getCurrentCase, stepCase } from "@/portal/cases";
import { resumeStep, stepPath } from "@/portal/steps";
import { CreateAccountForm } from "./_forms/account-forms";
import { currentApplicant } from "./session";

// 2.1.1 Create account (1/2)
export default async function ApplyPage() {
  const applicant = await currentApplicant();
  if (applicant) redirect(stepPath(resumeStep(stepCase(getCurrentCase(portalDeps(), applicant.id)))));
  return (
    <div className="card">
      <h1>Create your account</h1>
      <p className="lede">Step 1 of 2. You can stop at any time and continue later.</p>
      <div className="banner info">Illustrative demo. Use made-up details and the SAMPLE documents only; never real personal data.</div>
      <CreateAccountForm />
      <p style={{ marginTop: 24 }}>
        Already started? <Link href="/apply/continue">Continue your application</Link>
      </p>
    </div>
  );
}
