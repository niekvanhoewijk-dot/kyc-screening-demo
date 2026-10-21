import { ApplicantShell } from "@/components/applicant-shell";
import { SignInForm } from "../_forms/account-forms";

// Returning applicant (no board): same frame as 2.1.1.
export default function ContinuePage() {
  return (
    <ApplicantShell
      panelTitle="Welcome back"
      panelBody="Your progress is saved. Confirm your email and you continue exactly where you stopped."
      c={null}
      current={null}
      eyebrow="Resume"
      title="Continue your application"
      lede="Enter the email you signed up with and we'll send you a code."
      narrow
    >
      <SignInForm />
    </ApplicantShell>
  );
}
