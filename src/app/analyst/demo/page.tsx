import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { applicants, cases } from "@/db/schema";
import { loadPersonas } from "@/demo/personas";
import { env } from "@/lib/env";
import { portalDeps } from "@/portal/deps";
import { BAND_LABEL } from "../labels";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";

// Demo controls: personas, Claude source, reset. Everything here is synthetic.
export default function DemoPage() {
  const deps = portalDeps();
  const personas = loadPersonas();
  const recorded = fs.readdirSync(path.resolve(/* turbopackIgnore: true */ process.cwd(), "fixtures/claude-cache")).filter((f) => f.endsWith(".json")).length;
  const byEmail = new Map(
    deps.db.select({ email: applicants.email, id: cases.id, risk: cases.riskResult }).from(cases).innerJoin(applicants, eq(cases.applicantId, applicants.id)).orderBy(desc(cases.createdAt)).all().map((r) => [r.email, r]),
  );
  const rows = [
    ...personas.individuals.map((p) => ({ id: p.id, name: `${p.first} ${p.last}`, email: p.email, expect: p.expect.band, story: p.story })),
    { id: personas.company.id, name: String(personas.company.company.legalName), email: personas.company.representative.email, expect: personas.company.expect.band, story: personas.company.story },
  ];
  return (
    <div className="stack">
      <div className="card wide">
        <h1>Demo controls</h1>
        <p className="lede">Illustrative demo on synthetic data. Not a regulated compliance system. See docs/DEMO-SCRIPT.md for the 5-minute walkthrough.</p>
        <dl className="kv">
          <dt>Claude</dt>
          <dd>{env.DEMO_MODE === "replay" ? <>Replay: recorded responses only, no API calls ({recorded} recorded). Missing recordings show as &quot;not recorded&quot;; record them once with <code>npm run demo:record</code>.</> : <>Live API calls ({env.CLAUDE_MODEL}); responses are recorded for replay.</>}</dd>
          <dt>Model</dt>
          <dd>{env.CLAUDE_MODEL}</dd>
        </dl>
      </div>
      <div className="card wide">
        <h2 style={{ marginTop: 0 }}>Personas</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Persona</th><th>Expected</th><th>Story</th><th>Case</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const c = byEmail.get(r.email);
                const band = (c?.risk as { band?: string } | null)?.band;
                return (
                  <tr key={r.id}>
                    <td>{r.name}<br /><span className="muted">{r.email}</span></td>
                    <td><span className={`pill ${r.expect}`}>{BAND_LABEL[r.expect]}</span></td>
                    <td>{r.story}</td>
                    <td>{c ? <Link href={`/analyst/cases/${c.id}`}>{band ? BAND_LABEL[band] : "open"}</Link> : <span className="muted">not seeded</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card wide">
        <h2 style={{ marginTop: 0 }}>Reset</h2>
        <p className="muted">Deletes every case, upload and audit entry in the local demo database, then seeds the personas again through the real portal services. Mode returns to MVP 1.</p>
        <ResetForm />
      </div>
    </div>
  );
}
