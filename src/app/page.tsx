import Link from "next/link";

export default function Home() {
  return (
    <div>
      <h1>Onboarding and screening demo</h1>
      <p>Scaffold only. Flows are built phase by phase (see docs/BUILD-PLAN.md).</p>
      <ul>
        <li><Link href="/apply">Applicant portal</Link></li>
        <li><Link href="/analyst">Analyst console</Link></li>
      </ul>
    </div>
  );
}
