import Link from "next/link";

export default function Home() {
  return (
    <div className="card">
      <h1>Onboarding and screening demo</h1>
      <p className="lede">Open an account as an applicant, then review and decide the case in the analyst console.</p>
      <div className="actions">
        <Link className="btn" href="/apply">Open an account</Link>
        <Link className="btn secondary" href="/apply/continue">Continue an application</Link>
      </div>
      <p style={{ marginTop: 24 }}>
        <Link href="/analyst">Analyst console</Link>
      </p>
    </div>
  );
}
