import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { portalDeps } from "@/portal/deps";
import { VerifyForm } from "../_forms/account-forms";
import { PENDING_EMAIL_COOKIE } from "../session";

// 2.1.2 Create account (2/2): check your email
export default async function VerifyPage() {
  const email = (await cookies()).get(PENDING_EMAIL_COOKIE)?.value;
  if (!email) redirect("/apply/continue");
  const { otp } = portalDeps().portal;
  return (
    <div className="card">
      <h1>Check your email</h1>
      <p className="lede">
        If <strong>{email}</strong> has an account, we've sent it a {otp.length}-digit code. It expires in {otp.ttl_minutes} minutes.
      </p>
      <div className="banner info">Demo: no email is sent. The code is printed in the server console.</div>
      <VerifyForm length={otp.length} />
      <p style={{ marginTop: 24 }}>
        Wrong email? <Link href="/apply/continue">Use a different one</Link>
      </p>
    </div>
  );
}
