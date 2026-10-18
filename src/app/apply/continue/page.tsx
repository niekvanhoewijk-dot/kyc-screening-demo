import Link from "next/link";
import { SignInForm } from "../_forms/account-forms";

export default function ContinuePage() {
  return (
    <div className="card">
      <h1>Continue your application</h1>
      <p className="lede">Enter the email you signed up with and we'll send you a code.</p>
      <SignInForm />
      <p style={{ marginTop: 24 }}>
        New here? <Link href="/apply">Create an account</Link>
      </p>
    </div>
  );
}
