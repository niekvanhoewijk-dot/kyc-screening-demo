import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

type Summary = {
  generated_at: string;
  model: string;
  prompt_version: string;
  mode: string;
  documents: { total: number; evaluated: number; not_recorded: number };
  exact_match: number;
  kyb_classification_accuracy: number | null;
  per_code: { code: string; support: number; tp: number; fp: number; fn: number; precision: number | null; recall: number | null }[];
  cost: { pricing_as_of: string; individual_case: number | null; company_case: number | null; company_case_assumes_documents: number };
};

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const usd = (x: number | null) => (x === null ? "n/a" : `$${x.toFixed(4)}`);

// Evaluation report (AnalystNav "Evaluation report"): the latest reports/eval-*.json from `npm run eval`.
export default function EvalPage() {
  const dir = path.resolve(/* turbopackIgnore: true */ process.cwd(), "reports");
  const latest = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^eval-.*\.json$/.test(f)).sort().at(-1) : undefined;
  const s = latest ? (JSON.parse(fs.readFileSync(path.join(dir, latest), "utf8")) as Summary) : null;
  return (
    <>
      <header className="head" style={{ gap: 10 }}>
        <span className="eyebrow">Measured, not anecdotal</span>
        <h1 className="title">Evaluation report</h1>
        <p className="lede" style={{ fontSize: 15 }}>Claude&apos;s document reading on the labelled synthetic set: precision and recall per reason code, and cost per case. Illustrative, not evidence of production accuracy.</p>
      </header>
      {!s ? (
        <section className="card">
          <p>No report yet. Run <code>npm run eval</code> in the project folder (replays recorded responses; no API key needed), then reload this page.</p>
        </section>
      ) : (
        <>
          <section className="tiles" aria-label="Summary">
            <div className="tile dark"><span className="eyebrow">Documents evaluated</span><span className="value">{s.documents.evaluated} of {s.documents.total}</span><span className="note">{s.documents.not_recorded ? `${s.documents.not_recorded} without a recording` : "All recorded"}</span></div>
            <div className="tile"><span className="eyebrow">Exact match</span><span className="value">{s.exact_match}</span><span className="note">Documents whose reason codes match the labels exactly</span></div>
            <div className="tile"><span className="eyebrow">KYB classification</span><span className="value">{pct(s.kyb_classification_accuracy)}</span><span className="note">Company documents read as the right type</span></div>
            <div className="tile"><span className="eyebrow">Cost per case</span><span className="value">{usd(s.cost.individual_case)}</span><span className="note">Individual (POI + POR). Company with {s.cost.company_case_assumes_documents} documents: {usd(s.cost.company_case)}</span></div>
          </section>
          <section className="card">
            <div className="card-head"><div><span className="eyebrow">{s.model} · prompt {s.prompt_version} · {s.mode}</span><h2 className="card-title">Per reason code</h2></div><span className="muted">{latest} · {s.generated_at.slice(0, 16).replace("T", " ")} UTC</span></div>
            <div className="table-scroll">
              <table className="tbl" style={{ minWidth: 560 }}>
                <thead><tr><th>Code</th><th className="num">Support</th><th className="num">TP</th><th className="num">FP</th><th className="num">FN</th><th className="num">Precision</th><th className="num">Recall</th></tr></thead>
                <tbody>
                  {s.per_code.map((c) => (
                    <tr key={c.code}><th scope="row">{c.code}</th><td className="num">{c.support}</td><td className="num">{c.tp}</td><td className="num">{c.fp}</td><td className="num">{c.fn}</td><td className="num">{pct(c.precision)}</td><td className="num">{pct(c.recall)}</td></tr>
                  ))}
                  {s.per_code.length === 0 && <tr><td colSpan={7} className="muted">Nothing evaluated yet: record responses with npm run docs:record.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="foot-note">Pricing as of {s.cost.pricing_as_of}. Full report: reports/{latest?.replace(".json", ".md")}.</p>
          </section>
        </>
      )}
    </>
  );
}
