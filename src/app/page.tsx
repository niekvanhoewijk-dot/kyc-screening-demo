import Link from "next/link";

export default function Home() {
  return (
    <div className="card">
      <h1>Onboarding and screening demo</h1>
      <p className="lede">Open an account as an applicant. The analyst console arrives in a later phase.</p>
      <div className="actions">
        <Link className="btn" href="/apply">Open an account</Link>
        <Link className="btn secondary" href="/apply/continue">Continue an application</Link>
      </div>
      {process.env.NODE_ENV !== "production" && (
        <p style={{ marginTop: 24, fontSize: 14 }}>
          Dev: <Link href="/dev/cases">decide submitted cases</Link>
        </p>
      )}
    </div>
  );
}
