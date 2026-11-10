import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Band } from "@/components/band";
import { applicants, cases } from "@/db/schema";
import { loadPersonas } from "@/demo/personas";
import { demoChoices, getDemoState } from "@/demo/prefill";
import { env } from "@/lib/env";
import { portalDeps } from "@/portal/deps";
import { setDemoModeAction } from "../actions";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";

// Demo controls (AnalystNav frame, simple content): personas, Claude source, reset. All synthetic.
export default function DemoPage() {
  const deps = portalDeps();
  const personas = loadPersonas();
  const demo = getDemoState(deps);
  const choices = demoChoices();
  const chosen = choices.find((c) => c.id === demo.persona)!;
  const cacheDir = path.resolve(/* turbopackIgnore: true */ process.cwd(), "fixtures/claude-cache");
  const recorded = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json")).length : 0;
  const byEmail = new Map(
    deps.db.select({ email: applicants.email, id: cases.id, risk: cases.riskResult }).from(cases).innerJoin(applicants, eq(cases.applicantId, applicants.id)).orderBy(desc(cases.createdAt)).all().map((r) => [r.email, r]),
  );
  const rows = [
    ...personas.individuals.map((p) => ({ id: p.id, name: `${p.first} ${p.last}`, email: p.email, expect: p.expect.band, story: p.story })),
    { id: personas.company.id, name: String(personas.company.company.legalName), email: personas.company.representative.email, expect: personas.company.expect.band, story: personas.company.story },
  ];
  return (
    <>
      <header className="head" style={{ gap: 10 }}>
        <span className="eyebrow">Illustrative demo</span>
        <h1 className="title">Demo controls</h1>
        <p className="lede" style={{ fontSize: 15 }}>Synthetic data only. Not a regulated compliance system. See docs/DEMO-SCRIPT.md for the 5-minute walkthrough.</p>
      </header>
      <section className="card">
        <div className="card-head"><div><span className="eyebrow">Open an account</span><h2 className="card-title">Demo Mode: {demo.on ? "on" : "off"}</h2></div></div>
        <p className="muted" style={{ lineHeight: 1.6 }}>
          When on, every screen of the apply flow comes pre-filled with a sample applicant, and the sample documents attach themselves. You only press Continue. Nothing is uploaded from your computer, and the applicant still sees the normal screens: no risk information is shown.
        </p>
        <form action={setDemoModeAction} className="stack">
          <div className="field" style={{ maxWidth: 420 }}>
            <label htmlFor="demo-persona">Sample applicant</label>
            <select id="demo-persona" name="persona" defaultValue={demo.persona} key={demo.persona}>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
            </select>
            <span className="hint">{chosen.story}</span>
          </div>
          <div className="actions">
            <button className="btn" type="submit" name="on" value="1">{demo.on ? "Save sample applicant" : "Turn on Demo Mode"}</button>
            {demo.on && <button className="btn outline" type="submit" name="on" value="0">Turn off</button>}
            {demo.on && <Link className="link" href="/apply" target="_blank" rel="noopener">Open the apply flow in a new tab</Link>}
          </div>
        </form>
        <p className="hint">Each click-through creates a new application with a made-up email address, so it never signs in to a seeded case. The sample applicant is fixed when the application starts. A reset keeps this setting.</p>
      </section>
      <section className="card">
        <div className="card-head"><div><span className="eyebrow">Claude</span><h2 className="card-title">Where answers come from</h2></div></div>
        <dl className="kv">
          <dt>Mode</dt>
          <dd>{env.DEMO_MODE === "replay" ? <>Replay: recorded responses only, no API calls ({recorded} recorded). Missing recordings show as &quot;not recorded&quot;; record them once with <code>npm run demo:record</code>.</> : <>Live API calls; responses are recorded for replay.</>}</dd>
          <dt>Model</dt>
          <dd>{env.CLAUDE_MODEL}</dd>
        </dl>
      </section>
      <section className="card">
        <div className="card-head"><div><span className="eyebrow">Synthetic cases</span><h2 className="card-title">Personas</h2></div></div>
        <div className="table-scroll">
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead><tr><th>Persona</th><th>Expected</th><th>Story</th><th>Case</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const c = byEmail.get(r.email);
                const band = (c?.risk as { band?: string } | null)?.band;
                return (
                  <tr key={r.id}>
                    <th scope="row">{r.name}<span className="sub">{r.email}</span></th>
                    <td><Band band={r.expect} /></td>
                    <td style={{ lineHeight: 1.55 }}>{r.story}</td>
                    <td>{c ? <Link className="link" href={`/analyst/cases/${c.id}`}>{band ? "Open" : "Open (not scored)"}</Link> : <span className="muted">Not seeded</span>}{band && <><br /><Band band={band} /></>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><div><span className="eyebrow">Start over</span><h2 className="card-title">Reset</h2></div></div>
        <p className="muted">Deletes every case, upload and audit entry in the local demo database, then seeds the personas again through the real portal services. Mode returns to MVP 1.</p>
        <ResetForm />
      </section>
    </>
  );
}
