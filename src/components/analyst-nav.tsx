import Link from "next/link";
import { chooseAnalystAction } from "@/app/analyst/actions";
import { AnalystNavLinks } from "./analyst-nav-links";

/** Analyst navigation (docs/design/AnalystNav.dc.html): black 260px rail. */
export function AnalystNav({ analysts, current, claudeSource }: { analysts: { id: string; name: string }[]; current: { id: string; name: string } | null; claudeSource: string }) {
  return (
    <nav className="an on-dark" aria-label="Analyst">
      <div className="an-brand">
        <Link href="/" className="lp-brand">Demo Digital Assets Platform</Link>
        <strong>Compliance</strong>
      </div>
      <AnalystNavLinks />
      <div className="an-foot">
        <form action={chooseAnalystAction} className="an-who">
          <label htmlFor="analyst" className="eyebrow">Signed in as</label>
          <select id="analyst" name="analyst" defaultValue={current?.id ?? ""} key={current?.id ?? "none"}>
            <option value="" disabled>Choose an analyst…</option>
            {analysts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div><button className="btn" type="submit">{current ? "Switch" : "Sign in"}</button></div>
        </form>
        <span className="an-note">Claude: {claudeSource}</span>
        <p className="an-note">Illustrative demo on synthetic data. Not a regulated compliance system.</p>
      </div>
    </nav>
  );
}
