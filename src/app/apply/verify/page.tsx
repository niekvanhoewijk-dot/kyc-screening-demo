import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApplicantShell } from "@/components/applicant-shell";
import { portalDeps } from "@/portal/deps";
import { VerifyForm } from "../_forms/account-forms";
import { PENDING_EMAIL_COOKIE } from "../session";

// 2.1.2 Verify email (docs/design/A02-Verify-Email.dc.html)
export default async function VerifyPage() {
  const email = (await cookies()).get(PENDING_EMAIL_COOKIE)?.value;
  if (!email) redirect("/apply/continue");
  const { otp } = portalDeps().portal;
  return (
    <ApplicantShell
      panelTitle="Check your email"
      panelBody={`We sent a ${otp.length}-digit code. Enter it to confirm that this address is yours.`}
      c={null}
      current="verify"
      title="Enter your code"
      lede={
        // Same wording for known and unknown addresses: the page never reveals whether an email has an account.
        <>If <strong style={{ color: "#0A0A0A", fontWeight: 600 }}>{email}</strong> has an account, we sent it a {otp.length}-digit code. It expires in {otp.ttl_minutes} minutes.</>
      }
      narrow
    >
      <VerifyForm length={otp.length} />
    </ApplicantShell>
  );
}
