import Link from "next/link";
import { listQueue } from "@/console/queue";
import { getMode } from "@/console/mode";
import { portalDeps } from "@/portal/deps";
import { BAND_LABEL, ROUTE_LABEL, STATUS_LABEL } from "./labels";

// Queue (spec 01): filter by band, status, age.
export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const deps = portalDeps();
  const mode = getMode(deps);
  const olderThanDays = sp.age ? Number(sp.age) : undefined;
  const rows = listQueue(deps, { band: sp.band || undefined, status: sp.status || undefined, olderThanDays });
  return (
    <div className="card wide">
      <h1>Queue</h1>
      <p className="lede">Oldest submission first. The rules engine scores every case; you decide.</p>
      <form className="inline-form" style={{ marginBottom: 16 }}>
        <select name="band" defaultValue={sp.band ?? ""} aria-label="Band">
          <option value="">All bands</option>
          {Object.entries(BAND_LABEL).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          <option value="none">Not scored</option>
        </select>
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).filter(([id]) => id !== "draft").map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
        <select name="age" defaultValue={sp.age ?? ""} aria-label="Age">
          <option value="">Any age</option>
          {deps.consoleConfig.age_filters_days.map((d) => <option key={d} value={d}>{d}+ days waiting</option>)}
        </select>
        <button className="btn small secondary" type="submit">Filter</button>
        <Link href="/analyst" className="muted" style={{ alignSelf: "center" }}>Clear</Link>
      </form>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Applicant</th><th>Status</th><th>Score</th><th>Engine routing</th><th>Screening</th>
              {mode === "mvp2" && <th>Claude pre-review</th>}
              <th>Waiting</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.caseId}>
                <td><Link href={`/analyst/cases/${r.caseId}`}>{r.applicant}</Link>{r.persona === "company" && <> <span className="pill">Company</span></>}<br /><span className="muted">{r.email}</span></td>
                <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                <td>{r.band ? <><span className={`pill ${r.band}`}>{BAND_LABEL[r.band]}</span> {r.total}</> : <span className="muted">Not scored</span>}</td>
                <td>{ROUTE_LABEL[r.route]}</td>
                <td>{r.openHits ? <span className="pill flag">{r.openHits} open</span> : <span className="muted">None open</span>}</td>
                {mode === "mvp2" && <td>{r.preReview ? <><span className="pill fail">{r.preReview.fail} fail</span> <span className="pill flag">{r.preReview.flag} flag</span></> : <span className="muted">Not run</span>}</td>}
                <td>{r.ageDays === null ? "-" : r.ageDays === 0 ? "Today" : `${r.ageDays} d`}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No cases match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
