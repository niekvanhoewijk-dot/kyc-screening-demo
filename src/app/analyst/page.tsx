import { inArray } from "drizzle-orm";
import Link from "next/link";
import { Band } from "@/components/band";
import { getMode, type Mode } from "@/console/mode";
import { listQueue } from "@/console/queue";
import { cases, screeningHits } from "@/db/schema";
import { caseGaps } from "@/kyb/load";
import { countryName } from "@/lib/countries";
import { portalDeps } from "@/portal/deps";
import { setModeAction } from "./actions";
import { BAND_LABEL, STATUS_LABEL } from "./labels";

type Risk = { band?: string; forced_by?: string; decision?: string; reason?: string; country?: { code: string; list: string } | null; basis?: string; driver?: { kind: string; name?: string } };

const LIST_FLAG: Record<string, string> = {
  fatf_call_for_action: "Country on FATF call for action",
  fatf_increased_monitoring: "Country on FATF increased monitoring",
  eu_sanctions_map: "Country on the EU sanctions map",
};
const HIT_LABEL: Record<string, string> = { sanctions: "sanctions", pep: "PEP", adverse_media: "adverse media" };

// Queue (docs/design/C01-Analyst-Queue.dc.html). Filters: search, band, type, status, age.
export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const deps = portalDeps();
  const mode = getMode(deps);
  const all = listQueue(deps, { band: sp.band || undefined, status: sp.status || undefined, olderThanDays: sp.age ? Number(sp.age) : undefined });
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = all
    .filter((r) => !sp.type || r.persona === sp.type)
    .filter((r) => !q || r.applicant.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.caseId.toLowerCase().startsWith(q));

  const ids = rows.map((r) => r.caseId);
  const caseRows = ids.length ? deps.db.select({ id: cases.id, risk: cases.riskResult, questionnaire: cases.questionnaire }).from(cases).where(inArray(cases.id, ids)).all() : [];
  const hits = ids.length ? deps.db.select().from(screeningHits).where(inArray(screeningHits.caseId, ids)).all() : [];
  const inForce = deps.policies.inForce(deps.now().toISOString());
  const meta = inForce.countries.meta;

  const flagsFor = (r: (typeof rows)[number]) => {
    const c = caseRows.find((x) => x.id === r.caseId);
    const risk = (c?.risk ?? null) as Risk | null;
    const flags: string[] = [];
    if (risk?.reason === "us_tax_resident") flags.push("US tax resident (hard rule)");
    if (risk?.country && LIST_FLAG[risk.country.list]) flags.push(`${LIST_FLAG[risk.country.list]} (${countryName(risk.country.code)})`);
    if ((c?.questionnaire as { pep?: boolean } | null)?.pep) flags.push("PEP declared");
    const open = hits.filter((h) => h.caseId === r.caseId && h.status === "open");
    for (const cat of [...new Set(open.map((h) => h.category))]) {
      const n = open.filter((h) => h.category === cat);
      flags.push(`${n.some((h) => h.strength === "strong") ? "Strong" : "Possible"} ${HIT_LABEL[cat]} screening match (${n.length})`);
    }
    if (risk?.basis === "demo_default_o8" && risk.driver?.kind === "person") flags.push(`Band set by ${risk.driver.name}`);
    if (r.persona === "company") {
      const missing = (caseGaps(deps, r.caseId, false) ?? []).filter((g) => g.code === "KYB_DOCUMENT_MISSING").length;
      if (missing) flags.push(`${missing} of ${deps.kyb.checklist.filter((i) => !i.provided_by).length} company documents missing`);
    }
    if (mode === "mvp2" && r.preReview) flags.push(`Claude pre-review: ${r.preReview.fail} fail, ${r.preReview.flag} flag`);
    return flags.length ? flags.join(" · ") : "None from rules or screening";
  };
  const scoreNote = (r: (typeof rows)[number]) => {
    const risk = caseRows.find((x) => x.id === r.caseId)?.risk as Risk | null;
    if (r.persona === "company") return "company default";
    if (risk?.decision === "reject") return "reject only";
    if (risk?.forced_by === "pep") return "raised to High by PEP";
    return "";
  };

  return (
    <>
      <header className="page-head">
        <div className="head" style={{ gap: 10 }}>
          <span className="eyebrow">Review queue</span>
          <h1 className="title">Cases</h1>
          <p className="lede" style={{ fontSize: 15 }}>{rows.length} case{rows.length === 1 ? "" : "s"} shown, oldest first. Scores were computed by the rules engine at submission.</p>
        </div>
        <form action={setModeAction}>
          <fieldset>
            <legend className="eyebrow" style={{ fontSize: 12, letterSpacing: ".1em", marginBottom: 8 }}>Mode</legend>
            <div className="segmented">
              {(["mvp1", "mvp2"] as Mode[]).map((m) => (
                <button key={m} type="submit" name="mode" value={m} aria-pressed={mode === m}>
                  {m === "mvp1" ? "MVP 1 · manual" : "MVP 2 · Claude pre-review"}
                </button>
              ))}
            </div>
          </fieldset>
        </form>
      </header>

      <form className="filters" role="search">
        <div className="field grow">
          <label htmlFor="q">Search</label>
          <input id="q" name="q" type="search" placeholder="Name, email or reference" defaultValue={sp.q ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="band">Risk band</label>
          <select id="band" name="band" defaultValue={sp.band ?? ""}>
            <option value="">All bands</option>
            {Object.entries(BAND_LABEL).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
            <option value="none">Not scored</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="type">Type</label>
          <select id="type" name="type" defaultValue={sp.type ?? ""}>
            <option value="">All types</option>
            <option value="individual">Individual</option>
            <option value="company">Company</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={sp.status ?? ""}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).filter(([id]) => id !== "draft").map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="age">Waiting</label>
          <select id="age" name="age" defaultValue={sp.age ?? ""}>
            <option value="">Any age</option>
            {deps.consoleConfig.age_filters_days.map((d) => <option key={d} value={d}>{d}+ days</option>)}
          </select>
        </div>
        <div className="actions tight">
          <button className="btn small" type="submit">Filter</button>
          <Link href="/analyst" className="link">Clear</Link>
        </div>
      </form>

      <div className="table-scroll">
        <table className="tbl queue">
          <caption className="sr-only">Cases waiting for review</caption>
          <thead>
            <tr><th scope="col">Applicant</th><th scope="col">Type</th><th scope="col">Band</th><th scope="col">Score</th><th scope="col">Status</th><th scope="col">Flags from rules and screening</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.caseId}>
                <th scope="row" style={{ fontWeight: 600 }}>
                  <Link href={`/analyst/cases/${r.caseId}`} className="link" style={{ fontSize: 14, fontWeight: 600 }}>{r.applicant}</Link>
                  <span className="sub">{r.ageDays === null ? "" : r.ageDays === 0 ? "Submitted today" : `Waiting ${r.ageDays} d`}</span>
                </th>
                <td>{r.persona === "company" ? "Company" : "Individual"}</td>
                <td><Band band={r.band} /></td>
                <td><span className="strong">{r.persona === "company" ? "n/a" : (r.total ?? "-")}</span>{scoreNote(r) && <span className="sub">{scoreNote(r)}</span>}</td>
                <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                <td style={{ color: "#262626", lineHeight: 1.5 }}>{flagsFor(r)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">No cases match.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted">Policy in force: {inForce.policy.id}, {inForce.policy.label}. Country data: FATF lists, as of {meta.as_of} ({meta.list_version}). Sample cases, all fictional.</p>
    </>
  );
}
