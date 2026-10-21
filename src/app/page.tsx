import Link from "next/link";
import { LeftPanel } from "@/components/left-panel";
import { ArrowIcon } from "@/components/icons";

export default function Home() {
  return (
    <div className="frame">
      <LeftPanel title="Onboarding and screening" body="An applicant portal and an analyst console. The rules engine decides the numbers, Claude assists, a person decides the case." />
      <main className="content">
        <div className="col narrow">
          <div className="head">
            <span className="eyebrow">Illustrative demo</span>
            <h1 className="title">Demo Digital Assets Platform</h1>
            <p className="lede">Open an account as an applicant, then review and decide the case in the analyst console. All data is synthetic.</p>
          </div>
          <div className="actions tight">
            <Link className="btn" href="/apply">Open an account <ArrowIcon /></Link>
            <Link className="btn outline" href="/apply/continue">Continue an application</Link>
          </div>
          <p><Link className="link" href="/analyst">Analyst console</Link></p>
        </div>
      </main>
    </div>
  );
}
