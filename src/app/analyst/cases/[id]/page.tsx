import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Band, BAND_LABEL } from "@/components/band";
import { Submit } from "@/components/form";
import { Ticked } from "@/components/icons";
import type { EddRequest, EddResultRecord } from "@/console/actions";
import { loadCaseView, type CaseView } from "@/console/case-view";
import { getMode } from "@/console/mode";
import type { Check } from "@/documents/checks";
import type { KybClassification } from "@/documents/kyb-schemas";
import type { CaseMemo } from "@/documents/memo";
import type { PreReview } from "@/documents/pre-review";
import type { PoiExtraction, PorExtraction } from "@/documents/schemas";
import { amountBandMax, sofPercent, uploadableItems, type BreakdownLine, type CompanyScore, type CountryResolution, type ThresholdResult } from "@/engine";
import type { Gap } from "@/kyb/gaps";
import { caseGaps } from "@/kyb/load";
import { countryName } from "@/lib/countries";
import type { IdentityData, QuestionnaireData, ResidenceData } from "@/portal/cases";
import { evidenceLevelOf, levelConfig, walletEvidenceOf } from "@/portal/evidence";
import type { CompanyData } from "@/portal/company";
import { portalDeps } from "@/portal/deps";
import type { EddSubmission } from "@/portal/edd";
import { PortalError } from "@/portal/errors";
import { decisionAction, draftMemoAction, eddRecalcAction, runPreReviewAction, startReviewAction, triageAction } from "../../actions";
import { ActionForm } from "../../action-form";
import { actorLabel, describe, when } from "../../audit-text";
import { answerLabel, STATUS_LABEL, usd } from "../../labels";

// Case view (docs/design/C02-Analyst-Case.dc.html for individuals, C03-Analyst-Company.dc.html for
// companies). Presentation only: data comes from loadCaseView and the server actions are unchanged.

type Risk = { total?: number; band?: string; score_band?: string; forced_by?: string; breakdown?: BreakdownLine[]; country?: CountryResolution | null; edd_required?: boolean; decision?: string; reason?: string };

const FACTOR: Record<string, string> = {
  country: "Country of residence",
  deposit_12m: "Planned deposit",
  source_of_funds: "Source of funds",
  employment_status: "Employment",
  occupation_industry: "Industry",
  annual_income: "Annual income",
  net_worth: "Net worth",
};
const SHORT_ROLE: Record<string, string> = { representative: "Representative", ubo: "UBO", shareholder: "Shareholder", director: "Director" };
const humanize = (s: string) => s.replaceAll("_", " ").replace(/^\w/, (m) => m.toUpperCase());
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "-");

function Card({ eyebrow, title, aside, children, id, basis }: { eyebrow: string; title: string; aside?: ReactNode; children: ReactNode; id: string; basis?: number }) {
  return (
    <section className="card" aria-labelledby={id} style={basis ? { flex: `1 1 ${basis}px` } : undefined}>
      <div className="card-head">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2 id={id} className="card-title">{title}</h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, note, dark }: { label: string; value: ReactNode; note: string; dark?: boolean }) {
  return (
    <div className={`tile${dark ? " dark" : ""}`}>
      <span className="eyebrow">{label}</span>
      <span className="value">{value}</span>
      <span className="note">{note}</span>
    </div>
  );
}

const KV = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="kv">{rows.map(([k, v]) => [<dt key={`${k}-k`}>{k}</dt>, <dd key={`${k}-v`}>{v ?? <span className="muted">-</span>}</dd>])}</dl>
);

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deps = portalDeps();
  let view: CaseView;
  try {
    view = loadCaseView(deps, id);
  } catch (e) {
    if (e instanceof PortalError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const mode = getMode(deps);
  const { c, applicant } = view;
  const company = c.persona === "company";
  const risk = c.riskResult as Risk | null;
  const companyRisk = c.riskResult as CompanyScore | null;
  const co = c.company as CompanyData | null;
  const name = company ? (co?.legalName ?? "Company") : `${applicant.firstName} ${applicant.lastName}`;
  const decided = c.status === "approved" || c.status === "rejected";
  const q = c.questionnaire as QuestionnaireData | null;
  const r = c.residence as ResidenceData | null;

  const metaLine = company
    ? [co && `Registered in ${countryName(co.countryOfIncorporation)}`, `${view.persons.length} people`, `representative ${applicant.firstName} ${applicant.lastName}`]
    : [r && countryName(r.country), q && answerLabel(deps.engine, "employment_status", q.employment_status).toLowerCase()];

  return (
    <>
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link href="/analyst">Cases</Link>
        <span aria-hidden="true"> / </span>
        <span>{name}</span>
      </nav>

      <header className="page-head">
        <div className="head" style={{ gap: 10 }}>
          <span className="eyebrow">{company ? "Company · business review" : "Individual · case review"}</span>
          <h1 className="title">{name}</h1>
          <p className="lede" style={{ fontSize: 15 }}>
            {[...metaLine.filter(Boolean), `submitted ${day(c.submittedAt)}`, `Mode: ${mode === "mvp2" ? "MVP 2, Claude pre-review on" : "MVP 1, Claude off"}`].join(" · ")}
          </p>
        </div>
        <span className="status-tag">{STATUS_LABEL[c.status] ?? c.status}</span>
      </header>

      {!decided && <Routing risk={risk} company={company} />}

      {company ? <CompanyTiles view={view} /> : <IndividualTiles view={view} />}

      {company ? (
        <>
          <div className="cards-row">
            <WhyCard risk={companyRisk} />
            <PeopleCard view={view} />
          </div>
          <CompanyDocumentsCard view={view} mode={mode} />
        </>
      ) : (
        <div className="cards-row">
          <ScoreCard risk={risk} />
          <ThresholdCard view={view} />
        </div>
      )}

      {mode === "mvp2" && <ClaudeCard view={view} />}
      <DecisionCard view={view} />
      <ScreeningCard view={view} />
      <EddCard view={view} />
      <DocumentsCard view={view} />
      {company ? <CompanyDetailsCard view={view} /> : <AnswersCard view={view} />}
      <AuditTrail view={view} />
    </>
  );
}

function Routing({ risk, company }: { risk: Risk | null; company: boolean }) {
  if (!risk) return null;
  if (risk.decision === "reject")
    return (
      <p className="banner error">
        Engine hard rule: <strong>{risk.reason === "us_tax_resident" ? "US tax resident" : risk.reason === "prohibited_band" ? "prohibited (FATF call for action)" : risk.reason}</strong>. The {company ? "company" : "client"} cannot be accepted; reject with a reason. The applicant sees only the neutral message (D7).
      </p>
    );
  if (risk.edd_required)
    return <p className="banner">Band <strong>{BAND_LABEL[risk.band!]}</strong>{risk.forced_by === "pep" ? " (PEP)" : ""}: enhanced due diligence is required before approval.</p>;
  return null;
}

// ---------------- Individual (C02) ----------------

function IndividualTiles({ view }: { view: CaseView }) {
  const deps = portalDeps();
  const risk = view.c.riskResult as Risk | null;
  const thr = view.c.thresholdResult as ThresholdResult | null;
  const edd = view.c.eddResult as EddResultRecord | null;
  const band = deps.engine.matrix.bands.find((b) => b.id === risk?.band);
  const open = view.hits.filter((h) => h.status === "open").length;
  const BIND: Record<string, string> = { deposit_band: "Set by the stated deposit band", sof_of_income: "Set by the source-of-funds share", category_cap: "Set by the category cap", hard_ceiling: "Set by the initial ceiling" };
  return (
    <section className="tiles" aria-label="Summary">
      <Tile label="Risk score" value={risk?.total ?? "-"} note={risk?.breakdown ? `Seven factors, rules engine${risk.forced_by ? `; band raised by ${risk.forced_by.toUpperCase()}` : ""}` : `Hard rule before scoring: ${risk?.reason ?? "-"}`} />
      <Tile label="Risk band" value={risk?.band ? BAND_LABEL[risk.band] : "-"} note={band ? `Band range ${band.min} to ${band.max ?? "and above"}` : "Not scored"} />
      <Tile
        dark
        label={edd?.result.outcome === "new_threshold" ? "Threshold after EDD" : "Initial threshold"}
        value={edd?.result.outcome === "new_threshold" ? usd(edd.result.new_threshold) : thr ? usd(thr.threshold) : "None"}
        note={edd?.result.outcome === "new_threshold" ? `Initial was ${thr ? usd(thr.threshold) : "-"}` : thr ? BIND[thr.binding]! : "The case cannot be accepted"}
      />
      <Tile label="Screening" value={`${view.hits.length} match${view.hits.length === 1 ? "" : "es"}`} note={`${open} open · ${view.hits[0]?.provider ?? "Demo watchlist (fictional)"}`} />
    </section>
  );
}

function ScoreCard({ risk }: { risk: Risk | null }) {
  const deps = portalDeps();
  if (!risk) return <Card id="h-score" eyebrow="Rules engine" title="Score breakdown"><p className="muted">Not scored.</p></Card>;
  if (!risk.breakdown)
    return (
      <Card id="h-score" eyebrow="Rules engine" title="Score breakdown">
        <p>Not scored: the hard rule <strong>{risk.reason === "us_tax_resident" ? "US tax resident" : risk.reason}</strong> applies before scoring. The client cannot be accepted.</p>
      </Card>
    );
  const band = deps.engine.matrix.bands.find((b) => b.id === risk.band);
  const fired = [
    risk.reason === "us_tax_resident" && "US tax resident",
    risk.forced_by === "pep" && `PEP: band raised from ${BAND_LABEL[risk.score_band!]} to ${BAND_LABEL[risk.band!]} (D9)`,
    risk.band === "prohibited" && "prohibited country",
  ].filter(Boolean);
  const country = risk.country;
  return (
    <Card id="h-score" eyebrow="Rules engine" title="Score breakdown">
      <div className="table-scroll">
        <table className="tbl" style={{ minWidth: 380 }}>
          <caption className="sr-only">Risk score by factor</caption>
          <thead><tr><th scope="col">Factor</th><th scope="col">Answer</th><th scope="col">Level</th><th scope="col" className="num">Points</th></tr></thead>
          <tbody>
            {risk.breakdown.map((b) => (
              <tr key={b.factor}>
                <th scope="row">{FACTOR[b.factor] ?? humanize(b.factor)}</th>
                <td>{b.factor === "country" ? (country ? countryName(country.code) : "Fixture override") : answerLabel(deps.engine, b.factor, b.answer)}</td>
                <td>{BAND_LABEL[b.tier] ?? b.tier}</td>
                <td className="num">{b.points}</td>
              </tr>
            ))}
            <tr className="total">
              <th scope="row" colSpan={3}>Total · band {BAND_LABEL[risk.score_band ?? risk.band!]}{band && ` (${band.min} to ${band.max ?? "and above"})`}</th>
              <td className="num" style={{ fontSize: 18 }}>{risk.total}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ lineHeight: 1.6 }}>
        {fired.length ? `Hard rules: ${fired.join("; ")}.` : "No hard rules fired: not a US tax resident, no PEP, no prohibited country."}{" "}
        {country && <>Country level: {country.source}, as of {country.as_of} ({country.list_version}){country.unassessed ? ", unassessed: conservative default" : ""}.</>}
      </p>
    </Card>
  );
}

function ThresholdCard({ view }: { view: CaseView }) {
  const deps = portalDeps();
  const thr = view.c.thresholdResult as ThresholdResult | null;
  const q = view.c.questionnaire as QuestionnaireData | null;
  const edd = view.c.eddResult as EddResultRecord | null;
  const t = deps.engine.matrix.threshold;
  if (!thr || !q)
    return (
      <Card id="h-thr" eyebrow="Rules engine" title="How the threshold is set">
        <p>No threshold: the case cannot be accepted.</p>
      </Card>
    );
  const pct = sofPercent(q.source_of_funds, q.onlySourceOfWealth, deps.engine);
  const incomeMax = amountBandMax("annual_income", q.annual_income, deps.engine);
  const cap = thr.limits.find((l) => l.kind === "category_cap")?.value;
  const capWhy = cap === t.caps.restricted_employment ? "Cap for student, unemployed or other employment" : cap === t.caps.high_or_auto_high_band ? "Cap for a High or Auto-High band" : "Standard cap for a Low or Medium band applicant";
  const NAME = { deposit_band: "Stated deposit band", sof_of_income: "Source of funds share", category_cap: "Category cap", hard_ceiling: "Initial ceiling" } as const;
  const HOW = {
    deposit_band: `Top of the band the applicant chose: ${answerLabel(deps.engine, "deposit_12m", q.deposit_12m)}`,
    sof_of_income: `${answerLabel(deps.engine, "source_of_funds", q.source_of_funds)}${q.onlySourceOfWealth ? " (only source of wealth)" : ""} counts for ${Math.round(pct * 100)}% of the income band top: ${Math.round(pct * 100)}% × ${incomeMax === null ? "-" : usd(incomeMax)}`,
    category_cap: capWhy,
    hard_ceiling: "Ceiling on any initial threshold (D2)",
  } as const;
  return (
    <Card id="h-thr" eyebrow="Rules engine" title="How the threshold is set">
      <p className="muted" style={{ fontSize: 14 }}>The initial threshold is the lowest of these limits. The lowest one binds.</p>
      <ul className="limits">
        {thr.limits.map((l) => (
          <li key={l.kind} className={l.kind === thr.binding ? "binding" : undefined}>
            <div className="what"><strong>{NAME[l.kind]}</strong><span>{HOW[l.kind]}</span></div>
            <div className="val">{usd(Math.floor(l.value))}<span className={`chip ${l.kind === thr.binding ? "bind" : "tag"}`}>{l.kind === thr.binding ? "Binding" : "Higher"}</span></div>
          </li>
        ))}
      </ul>
      {edd?.result.outcome === "new_threshold" && <p><strong>After EDD: {usd(edd.result.new_threshold)}</strong> (headroom {usd(edd.result.headroom)}). The initial ceiling does not apply after EDD (O-2).</p>}
      <p className="foot-note">Source-of-funds percentages and caps come from config/risk-matrix.yaml. The ceiling applies to the initial threshold only.</p>
    </Card>
  );
}

// ---------------- Company (C03) ----------------

function CompanyTiles({ view }: { view: CaseView }) {
  const deps = portalDeps();
  const risk = view.c.riskResult as CompanyScore | null;
  const items = uploadableItems(deps.kyb);
  const received = items.filter((i) => view.docs.some((d) => d.kind === "company_doc" && d.docType === i.id)).length;
  const roles = (id: string) => view.persons.filter((p) => (p.roles as string[]).includes(id)).length;
  return (
    <section className="tiles" aria-label="Summary">
      <Tile dark label="Company band" value={risk ? BAND_LABEL[risk.band] : "-"} note={risk?.decision === "reject" ? "Cannot be accepted" : risk?.edd_required ? "Enhanced due diligence applies" : "Standard review"} />
      <Tile label="Documents" value={`${received} of ${items.length}`} note={received === items.length ? "All received" : `${items.length - received} still to be received`} />
      <Tile label="People" value={view.persons.length} note={`${roles("ubo")} UBO · ${roles("shareholder")} shareholder · ${roles("director")} board`} />
      <Tile label="Initial threshold" value="Not set" note="Not defined for companies (O-32)" />
    </section>
  );
}

function WhyCard({ risk }: { risk: CompanyScore | null }) {
  if (!risk) return <Card id="h-band" eyebrow="Rules engine" title="Company band"><p className="muted">Not scored.</p></Card>;
  const driver = risk.driver.kind === "company_country" ? "the country of incorporation" : risk.driver.name;
  const meaning = risk.decision === "reject" ? "The company cannot be accepted." : risk.edd_required ? `${BAND_LABEL[risk.band]} means enhanced due diligence before approval.` : "No enhanced due diligence is required by the band.";
  return (
    <Card id="h-band" eyebrow="Rules engine" title={`Why the company is ${BAND_LABEL[risk.band]}`} basis={340}>
      <p style={{ color: "#262626", lineHeight: 1.7 }}>The company takes the highest band among its people and its country of incorporation. Here the band is set by {driver}. {meaning}</p>
      <ul className="kv-list">
        <li><span>Company country: {countryName(risk.companyCountry.code)}</span><span>{BAND_LABEL[risk.companyCountryBand]}</span></li>
        {risk.persons.map((p) => (
          <li key={p.id}><span>{p.name}, {countryName(p.country.code)}{p.country.list !== "default" && p.country.list !== "demo_seed_low" ? ` (${p.country.source})` : ""}{p.raisedBy === "pep" ? ", PEP" : ""}</span><span>{BAND_LABEL[p.band]}</span></li>
        ))}
      </ul>
      <p className="foot-note">Demo default for company scoring (O-8), to be confirmed with compliance. Country level: {risk.companyCountry.source}, as of {risk.companyCountry.as_of}.</p>
    </Card>
  );
}

function PeopleCard({ view }: { view: CaseView }) {
  const deps = portalDeps();
  const risk = view.c.riskResult as CompanyScore | null;
  const identity = view.c.identity as IdentityData | null;
  const has = (pid: string, kind: string) => view.docs.some((d) => d.personId === pid && d.kind === kind);
  const shares = view.persons.filter((p) => p.sharePercent !== null).map((p) => Number(p.sharePercent));
  const total = shares.reduce((a, b) => a + b, 0);
  const ok = shares.length > 0 && Math.abs(total - deps.kyb.shareholding_total_percent) < 1e-6;
  return (
    <Card id="h-people" eyebrow="Ownership and control" title="People linked to the company" basis={560}>
      <div className="table-scroll">
        <table className="tbl" style={{ minWidth: 460 }}>
          <caption className="sr-only">People linked to the company</caption>
          <thead><tr><th scope="col">Person</th><th scope="col">Roles</th><th scope="col">Shares</th><th scope="col">Residence</th><th scope="col">Band</th></tr></thead>
          <tbody>
            {view.persons.map((p) => (
              <tr key={p.id}>
                <th scope="row" style={{ fontWeight: 600 }}>
                  {p.fullName}
                  <span className="sub">
                    {p.isApplicant
                      ? identity?.selfie === "passed" ? "Representative, identity verified" : "Representative"
                      : has(p.id, "person_poi") && has(p.id, "person_por") ? "ID and address uploaded" : "Documents missing"}
                    {p.pep ? " · PEP declared" : ""}
                  </span>
                </th>
                <td>{(p.roles as string[]).map((r) => SHORT_ROLE[r] ?? r).join(", ")}</td>
                <td className="strong">{p.sharePercent ? `${p.sharePercent}%` : "-"}</td>
                <td>{countryName(p.countryOfResidence)}</td>
                <td><Band band={risk?.persons.find((x) => x.id === p.id)?.band} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="readonly" style={{ flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>Shareholdings: {shares.length ? `${shares.join("% + ")}% = ${total}%` : "none declared"}</span>
        {ok ? <Ticked>Pass</Ticked> : <span className="chip fail">Not {deps.kyb.shareholding_total_percent}%</span>}
      </div>
    </Card>
  );
}

function CompanyDocumentsCard({ view, mode }: { view: CaseView; mode: string }) {
  const deps = portalDeps();
  const items = uploadableItems(deps.kyb);
  const docs = view.docs.filter((d) => d.kind === "company_doc");
  const gaps: Gap[] = caseGaps(deps, view.c.id, mode === "mvp2") ?? [];
  const classOf = (docId: string) => {
    const r = view.kybReadingOf(docId);
    return r?.status === "ok" ? (r.extraction as KybClassification) : null;
  };
  const covered = (id: string) => docs.filter((d) => d.docType === id || (mode === "mvp2" && classOf(d.id)?.document_type === id));
  const received = items.filter((i) => covered(i.id).length > 0).length;
  const otherGaps = gaps.filter((g) => g.code !== "KYB_DOCUMENT_MISSING");
  const label = (id: string | null) => (id ? (items.find((i) => i.id === id)?.label ?? id) : "Unsorted");
  return (
    <Card id="h-docs" eyebrow="Business documents" title="What we have and what is missing" aside={<span className="strong">{received} of {items.length} received</span>}>
      <div className="progress" role="img" aria-label={`${received} of ${items.length} documents received`}><div style={{ width: `${(received / items.length) * 100}%` }} /></div>
      <div className="table-scroll">
        <table className="tbl" style={{ minWidth: 520 }}>
          <caption className="sr-only">Company document checklist</caption>
          <thead><tr><th scope="col">Document</th><th scope="col">Status</th><th scope="col">Note</th></tr></thead>
          <tbody>
            {items.map((i) => {
              const files = covered(i.id);
              const note = gaps.find((g) => g.item === i.id && g.code !== "KYB_DOCUMENT_MISSING")?.detail;
              return (
                <tr key={i.id}>
                  <th scope="row">{i.item}. {i.label}</th>
                  <td><span className={`chip ${files.length ? "pass" : "fail"}`}>{files.length ? "Received" : "Missing"}</span></td>
                  <td className="muted">{note ?? files.map((f) => <a key={f.id} className="link" style={{ fontSize: 13, marginRight: 8 }} href={`/analyst/documents/${f.id}`} target="_blank" rel="noreferrer">{f.originalName}</a>)}</td>
                </tr>
              );
            })}
            <tr>
              <th scope="row">{deps.kyb.checklist.find((i) => i.provided_by)?.item}. Corporate questionnaire</th>
              <td><span className="chip pass">In portal</span></td>
              <td className="muted">Answered in the company step</td>
            </tr>
          </tbody>
        </table>
      </div>
      {otherGaps.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <h3 className="mini-head" style={{ margin: 0 }}>Other gaps ({otherGaps.length})</h3>
          <ul className="checks">
            {otherGaps.map((g, i) => (
              <li key={i}>
                <div className="what">{g.detail}<span>{[g.code, g.source === "claude" ? "from Claude's reading" : "from declared data"].filter(Boolean).join(" · ")}</span></div>
                <span className={`chip ${g.severity === "missing" ? "fail" : "flag"}`}>{g.severity === "missing" ? "Missing" : "Check"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mode === "mvp2" && (
        <div className="soft">
          <div className="card-head" style={{ alignItems: "baseline" }}>
            <h3 style={{ fontSize: 15, fontWeight: 600 }}>Classification check</h3>
            <span className="mini-head" style={{ margin: 0 }}>MVP 2 · Advisory</span>
          </div>
          {docs.length === 0 ? <p className="muted">No company documents uploaded.</p> : (
            <div className="table-scroll">
              <table className="tbl" style={{ minWidth: 520 }}>
                <thead><tr><th scope="col">File</th><th scope="col">Uploaded as</th><th scope="col">Claude reads it as</th></tr></thead>
                <tbody>
                  {docs.map((d) => {
                    const reading = view.kybReadingOf(d.id);
                    const x = classOf(d.id);
                    return (
                      <tr key={d.id}>
                        <th scope="row"><a className="link" style={{ fontSize: 14 }} href={`/analyst/documents/${d.id}`} target="_blank" rel="noreferrer">{d.originalName}</a></th>
                        <td>{label(d.docType)}</td>
                        <td>
                          {!reading ? <span className="muted">Not read yet</span> : !x ? <span className="muted">Not recorded or extraction failed</span> : (
                            <>
                              <strong>{x.document_type === "unrecognised" ? "Unrecognised" : label(x.document_type)}</strong> <span className="muted">({Math.round(x.overall_confidence * 100)}%)</span>
                              {x.persons.length > 0 && <span className="sub">{x.persons.map((p) => `${p.name} (${p.role}${p.share_percent !== null ? ` ${p.share_percent}%` : ""})`).join(", ")}</span>}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="small" style={{ color: "#262626" }}>Claude classifies; the gap list above is code. Advisory only. The decision rests with the analyst.</p>
        </div>
      )}
    </Card>
  );
}

function CompanyDetailsCard({ view }: { view: CaseView }) {
  const deps = portalDeps();
  const co = view.c.company as CompanyData | null;
  if (!co) return null;
  return (
    <Card id="h-company" eyebrow="Declared by the representative" title="Company details">
      <KV rows={[
        ["Legal name", co.legalName],
        ["Registration no.", co.registrationNumber],
        ["Incorporated in", countryName(co.countryOfIncorporation)],
        ["Registered address", [co.addressLine1, co.city, co.postcode, countryName(co.addressCountry)].filter(Boolean).join(", ")],
        ["Industry", `${answerLabel(deps.engine, "occupation_industry", co.industry)}${co.industryDetail ? `: ${co.industryDetail}` : ""}`],
        ["Expected deposits", answerLabel(deps.engine, "deposit_12m", co.deposit_12m)],
        ["Source of funds", answerLabel(deps.engine, "source_of_funds", co.source_of_funds)],
      ]} />
    </Card>
  );
}

// ---------------- Shared ----------------

function ClaudeCard({ view }: { view: CaseView }) {
  const deps = portalDeps();
  const pre = view.c.preReview as PreReview | null;
  const memo = view.c.memo as CaseMemo | null;
  const order: Record<Check["status"], number> = { fail: 0, flag: 1, pass: 2 };
  const RESULT = { pass: "Pass", flag: "Flag", fail: "Fail" } as const;
  const readings = [view.readings.poi, view.readings.por].filter((x): x is NonNullable<typeof x> => !!x && x.status === "ok");
  const fields = readings.flatMap((rd) => (rd.extraction as PoiExtraction | PorExtraction).fields.map((f) => ({ ...f, doc: rd.kind === "poi" ? "Identity document" : "Proof of residence" })));
  const failed = [view.readings.poi, view.readings.por].filter((x) => x && x.status === "failed");
  const ACTION = { approve: "approve", edd: "request EDD", reject: "reject", needs_human_review: "needs human review" } as const;
  return (
    <Card id="h-claude" eyebrow="MVP 2 · Claude pre-review" title="Document checks and case memo" aside={<span className="chip outline">Advisory</span>}>
      <div className="cols" style={{ gap: 32 }}>
        <div style={{ flexBasis: 380 }} className="stack">
          <h3 style={{ fontSize: 15, fontWeight: 600 }}>Checks</h3>
          {pre ? (
            <ul className="checks">
              {[...pre.checks].sort((a, b) => order[a.status] - order[b.status]).map((x) => (
                <li key={x.name}>
                  <div className="what">{humanize(x.name)}<span>{[x.reason_codes.join(", "), x.detail].filter(Boolean).join(". ")}{x.source === "claude" ? " (Claude's observation)" : ""}</span></div>
                  <span className={`chip ${x.status}`}>{RESULT[x.status]}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Not run for this case yet.</p>}
          <ActionForm key="pre" action={runPreReviewAction} hidden={{ caseId: view.c.id }} submit={pre ? "Run again" : "Run pre-review"} pending="Claude is reading…" variant="outline" />
        </div>
        <div style={{ flexBasis: 380 }} className="stack">
          <h3 style={{ fontSize: 15, fontWeight: 600 }}>Fields read from the documents</h3>
          {fields.length ? (
            <div className="table-scroll">
              <table className="tbl" style={{ minWidth: 340 }}>
                <caption className="sr-only">Extracted fields with confidence</caption>
                <thead><tr><th scope="col">Field</th><th scope="col">Read as</th><th scope="col" className="num">Confidence</th></tr></thead>
                <tbody>
                  {fields.map((f, i) => (
                    <tr key={i}>
                      <th scope="row">{humanize(f.field)}<span className="sub">{f.doc}</span></th>
                      <td>{f.value ?? <span className="muted">not found</span>}<span className="sub">{f.evidence}</span></td>
                      <td className="num">{Math.round(f.confidence * 100)}%{f.confidence < deps.checkRules.confidence_threshold && <span className="sub">below {Math.round(deps.checkRules.confidence_threshold * 100)}%: review</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">{failed.length ? "No fields: the reading is not recorded or failed. Review the documents yourself." : "Nothing read yet."}</p>}
          {readings[0] && <span className="muted">{readings[0].model} · prompt {readings[0].promptVersion} · {readings[0].source}</span>}
        </div>
      </div>
      <div className="soft">
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Case memo</h3>
        {memo ? (
          <>
            <p style={{ color: "#262626", lineHeight: 1.7 }}>{memo.summary}</p>
            <p>Suggested, under the engine routing: <strong>{ACTION[memo.recommended_action]}</strong></p>
            {memo.screening_notes && <p><span className="muted">Screening:</span> {memo.screening_notes}</p>}
            {memo.suggested_edd_requests.length > 0 && <div><span className="muted">If EDD, ask for:</span><ul className="bullets">{memo.suggested_edd_requests.map((x) => <li key={x}>{x}</li>)}</ul></div>}
            <details><summary className="muted" style={{ cursor: "pointer" }}>Engine result as restated in the memo (copied by code)</summary><ul className="bullets" style={{ marginTop: 8 }}>{memo.score_breakdown_restatement.map((l) => <li key={l}>{l}</li>)}</ul></details>
            <span className="muted">{memo.model} · {memo.promptVersion} · {when(memo.draftedAt)}</span>
          </>
        ) : <p className="muted">No memo yet.</p>}
        <p className="small strong" style={{ letterSpacing: ".04em" }}>Advisory only. The decision rests with the analyst.</p>
        <ActionForm key="memo" action={draftMemoAction} hidden={{ caseId: view.c.id }} submit={memo ? "Redraft memo" : "Draft memo"} pending="Claude is writing…" variant="outline" />
      </div>
    </Card>
  );
}

function DecisionCard({ view }: { view: CaseView }) {
  const { c, actions } = view;
  const company = c.persona === "company";
  const thr = c.thresholdResult as ThresholdResult | null;
  const edd = c.eddResult as EddResultRecord | null;
  if (actions.start_review.allowed)
    return (
      <Card id="h-dec" eyebrow="Analyst decision" title="Start the review">
        <p className="muted">Start the review to triage screening hits and record a decision. This is logged under your name.</p>
        <ActionForm key="start" action={startReviewAction} hidden={{ caseId: c.id }} submit="Start review" arrow />
      </Card>
    );
  if (c.status === "approved" || c.status === "rejected")
    return (
      <Card id="h-dec" eyebrow="Analyst decision" title={STATUS_LABEL[c.status]!}>
        <KV rows={[["Reason", c.decisionReason], ["By", c.decidedBy], ["At", c.decidedAt && when(c.decidedAt)]]} />
      </Card>
    );
  const limit = edd?.result.outcome === "new_threshold" ? edd.result.new_threshold : thr?.threshold;
  const options = [
    { id: "approve", label: "Approve", sub: company ? "Open the account." : limit !== undefined ? `Open the account with a ${usd(limit)} threshold.` : "Open the account.", a: actions.approve },
    { id: "edd", label: company ? "Request more information" : "Request more information", sub: "Ask for further documents (EDD). Wording shown to the applicant stays neutral.", a: actions.request_edd },
    { id: "reject", label: "Reject", sub: "Applicant sees the neutral no-go message.", a: actions.reject },
  ];
  const anyAllowed = options.some((o) => o.a.allowed);
  if (!anyAllowed)
    return (
      <Card id="h-dec" eyebrow="Analyst decision" title="Waiting for the applicant">
        <p className="muted">{c.status === "edd_requested" ? "Enhanced due diligence was requested. The decision opens again once the applicant has sent the documents." : options[0]!.a.why}</p>
      </Card>
    );
  const reason = (
    <div className="field">
      <label htmlFor="reason">Reason for the decision <span className="optional">(required, kept in the audit trail; the applicant never sees it)</span></label>
      <textarea id="reason" name="reason" rows={company ? 3 : 4} />
    </div>
  );
  if (company)
    return (
      <Card id="h-dec" eyebrow="Analyst decision" title="Next step for this company">
        <ActionForm
          key={`decide-${c.status}`}
          action={decisionAction}
          hidden={{ caseId: c.id }}
          buttons={
            <div className="actions tight">
              {options[1]!.a.allowed && <Submit name="action" value="edd" pending="Recording…">Request more information</Submit>}
              {options[2]!.a.allowed && <Submit name="action" value="reject" variant="outline" arrow={false} pending="Recording…">Reject</Submit>}
              {options[0]!.a.allowed ? (
                <Submit name="action" value="approve" variant="outline" arrow={false} pending="Recording…">Approve</Submit>
              ) : (
                <>
                  <button type="button" className="btn" disabled aria-describedby="approve-note">Approve</button>
                  <span id="approve-note" className="muted" style={{ flex: "1 1 220px", lineHeight: 1.5 }}>{options[0]!.a.why}</span>
                </>
              )}
            </div>
          }
        >
          {reason}
        </ActionForm>
      </Card>
    );
  const firstAllowed = options.find((o) => o.a.allowed)!.id;
  return (
    <Card id="h-dec" eyebrow="Analyst decision" title="Record your decision">
      <ActionForm
        key={`decide-${c.status}`}
        action={decisionAction}
        hidden={{ caseId: c.id }}
        buttons={
          <div className="actions">
            <Submit pending="Recording…">Record decision</Submit>
            <Link href="/analyst" className="link">Back to cases</Link>
          </div>
        }
        className="stack-lg"
      >
        <fieldset>
          <legend className="sr-only">Decision</legend>
          <div className="cards">
            {options.map((o) => (
              <label key={o.id} className="choice-card tall" aria-disabled={!o.a.allowed}>
                <input type="radio" name="action" value={o.id} defaultChecked={o.id === firstAllowed} disabled={!o.a.allowed} />
                <span>
                  <span className="strong">{o.label}</span>
                  <span className="sub">{o.a.allowed ? o.sub : o.a.why}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {reason}
      </ActionForm>
    </Card>
  );
}

function ScreeningCard({ view }: { view: CaseView }) {
  const reviewing = ["in_review", "edd_submitted"].includes(view.c.status);
  const company = view.c.persona === "company";
  const first = view.hits[0];
  return (
    <Card id="h-screen" eyebrow={first ? `${first.provider} · ${first.listVersion}` : "Demo watchlist (fictional)"} title="Screening hits">
      {view.hits.length === 0 ? <p className="muted">No hits.</p> : (
        <div className="table-scroll">
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead><tr>{company && <th scope="col">Subject</th>}<th scope="col">List entry</th><th scope="col">Category</th><th scope="col">Match</th><th scope="col">Strength</th><th scope="col">Triage</th></tr></thead>
            <tbody>
              {view.hits.map((h) => {
                const m = h.match as { nameSimilarity: number; dob: string; country: string };
                return (
                  <tr key={h.id}>
                    {company && <td>{h.subject === "company" ? "Company" : (view.persons.find((p) => p.id === h.subject)?.fullName ?? "-")}</td>}
                    <th scope="row">{h.entryName}<span className="sub">{h.entryId} · {h.program}</span></th>
                    <td>{h.category === "pep" ? "PEP" : humanize(h.category)}</td>
                    <td>Name {Math.round(m.nameSimilarity * 100)}%<span className="sub">DOB {m.dob.replace("_", " ")} · country {m.country}</span></td>
                    <td><span className={`chip ${h.strength === "strong" ? "fail" : "flag"}`}>{h.strength === "strong" ? "Strong" : "Possible"}</span></td>
                    <td>
                      {h.status !== "open" ? (
                        <><strong>{humanize(h.status)}</strong><span className="sub">{h.triageReason} ({h.triagedBy})</span></>
                      ) : reviewing ? (
                        <ActionForm action={triageAction} hidden={{ caseId: view.c.id, hitId: h.id }} submit="Record" className="triage">
                          <select name="verdict" aria-label="Verdict" defaultValue="false_positive">
                            <option value="false_positive">False positive</option>
                            <option value="true_match">True match</option>
                          </select>
                          <input name="reason" placeholder="Reason (required)" aria-label="Triage reason" />
                        </ActionForm>
                      ) : <span className="muted">Open. Start the review to triage.</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="foot-note">Only an analyst clears a hit. A confirmed PEP match re-scores the case (the person counts as PEP, D9); a confirmed sanctions match blocks approval.</p>
    </Card>
  );
}

function EddCard({ view }: { view: CaseView }) {
  const deps = portalDeps();
  const { c, actions } = view;
  const req = c.eddRequest as EddRequest | null;
  if (!req) return null;
  const sub = c.eddSubmission as EddSubmission | null;
  const res = c.eddResult as EddResultRecord | null;
  const o = res?.result;
  const sof = (c.questionnaire as QuestionnaireData | null)?.source_of_funds ?? (c.company as CompanyData | null)?.source_of_funds ?? "";
  return (
    <Card id="h-edd" eyebrow="Spec 05" title="Enhanced due diligence">
      <KV rows={[
        ["Requested", `${when(req.requestedAt)} by ${req.requestedBy}: ${req.reason}`],
        ["Asked for", <>Proof of source of funds · extra KYC {req.items.extraKyc === "already_satisfied" ? "already satisfied by the verified selfie" : "required"}</>],
        ["Applicant sent", sub ? `${sub.sofDocuments} source-of-funds document(s)${sub.extraKyc ? " + ID-holding photo" : ""} on ${day(sub.submittedAt)}${sub.note ? `: "${sub.note}"` : ""}` : "Waiting for the applicant"],
        ["Engine result", o ? (
          o.outcome === "new_threshold" ? <>New threshold <strong>{usd(o.new_threshold)}</strong>, headroom {usd(o.headroom)}</>
          : o.outcome === "return_excess_and_block" ? <>Source of funds does not cover deposits: return <strong>{usd(o.excess_to_return)}</strong>, block further deposits, report to AML and Compliance</>
          : <>No source of funds: return all funds (<strong>{usd(o.amount_to_return)}</strong>), terminate, report to AML and Compliance</>
        ) : null],
      ]} />
      {actions.recalculate_edd.allowed && (
        <ActionForm action={eddRecalcAction} hidden={{ caseId: c.id }} submit="Recalculate (rules engine)" variant="outline">
          <p className="muted">Enter what the documents evidence. The engine applies the source-of-funds percentage for {answerLabel(deps.engine, "source_of_funds", sof).toLowerCase()} (spec 05).</p>
          <div className="row">
            <div className="field"><label htmlFor="documentedAnnualAmount">Documented annual amount (USD)</label><input id="documentedAnnualAmount" name="documentedAnnualAmount" inputMode="numeric" defaultValue={res?.input.documentedAnnualAmount ?? ""} /></div>
            <div className="field"><label htmlFor="depositedToDate">Deposited to date (USD)</label><input id="depositedToDate" name="depositedToDate" inputMode="numeric" defaultValue={res?.input.depositedToDate ?? 0} /></div>
          </div>
          <label className="choice" style={{ fontSize: 14 }}><input type="checkbox" name="noSof" defaultChecked={res ? res.input.documentedAnnualAmount === null : false} /> No source of funds provided</label>
        </ActionForm>
      )}
    </Card>
  );
}

const DOC_LABEL: Record<string, string> = { poi_front: "Identity document (front)", poi_back: "Identity document (back)", selfie: "Selfie", por: "Proof of residence", sof: "Source of funds", edd_kyc: "EDD: ID-holding photo", person_poi: "ID", person_por: "Proof of residence" };

function DocumentsCard({ view }: { view: CaseView }) {
  const docs = view.docs.filter((d) => d.kind !== "company_doc" && !d.personId);
  const face = view.faces.at(-1);
  const person = view.docs.filter((d) => d.personId);
  return (
    <Card id="h-files" eyebrow={view.c.persona === "company" ? "Representative and people" : "Uploaded by the applicant"} title="Documents on file">
      <div className="doc-grid">
        {docs.map((d) => {
          const src = `/analyst/documents/${d.id}`;
          return (
            <figure key={d.id} style={{ margin: 0 }} className="stack">
              <figcaption className="muted">{DOC_LABEL[d.kind] ?? d.kind}{d.docType ? ` · ${humanize(d.docType)}` : ""}</figcaption>
              {d.mime.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <a href={src} target="_blank" rel="noreferrer"><img className="doc-thumb" src={src} alt={`${DOC_LABEL[d.kind] ?? d.kind}: ${d.originalName}`} /></a>
              ) : <a className="link" href={src} target="_blank" rel="noreferrer">{d.originalName} (open PDF)</a>}
            </figure>
          );
        })}
      </div>
      <KV rows={[["Face match", face ? `${face.provider}: liveness ${face.liveness}, match ${face.match} (${face.score}), ${view.faces.length} attempt${view.faces.length === 1 ? "" : "s"}` : "not run"]]} />
      {person.length > 0 && (
        <ul className="checks">
          {view.persons.filter((p) => !p.isApplicant).map((p) => (
            <li key={p.id}>
              <div className="what">{p.fullName}<span>{person.filter((d) => d.personId === p.id).map((d) => <a key={d.id} className="link" style={{ fontSize: 12, marginRight: 10 }} href={`/analyst/documents/${d.id}`} target="_blank" rel="noreferrer">{DOC_LABEL[d.kind]}: {d.originalName}</a>)}</span></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AnswersCard({ view }: { view: CaseView }) {
  const deps = portalDeps();
  const engine = deps.engine;
  const q = view.c.questionnaire as QuestionnaireData | null;
  const r = view.c.residence as ResidenceData | null;
  const i = view.c.identity as IdentityData | null;
  if (!q || !r || !i) return null;
  const ev = walletEvidenceOf(i);
  const level = evidenceLevelOf(i);
  const yes = (b: boolean) => (b ? "Yes" : "No");
  return (
    <div className="cards-row">
      <Card id="h-q" eyebrow="Declared by the applicant" title="Questionnaire">
        <KV rows={[
          ["Intake channel", intakeChannel(q.provenance)],
          ["Date of birth", via(q, "dateOfBirth", q.dateOfBirth)], ["Nationality", via(q, "nationality", countryName(q.nationality))], ["Language", via(q, "preferredLanguage", q.preferredLanguage)], ["Phone", via(q, "phone", q.phone)],
          ["TIN", via(q, "tin", q.tin ?? <>none: {q.tinMissingReason}</>)], ["US tax resident", via(q, "usTaxResident", yes(q.usTaxResident))], ["PEP (declared)", via(q, "pep", yes(q.pep))],
          ["Deposit 12 months", via(q, "deposit_12m", answerLabel(engine, "deposit_12m", q.deposit_12m))],
          ["Source of funds", via(q, "source_of_funds", `${answerLabel(engine, "source_of_funds", q.source_of_funds)}${q.onlySourceOfWealth ? " (only source of wealth)" : ""}`)],
          ["Employment", via(q, "employment_status", answerLabel(engine, "employment_status", q.employment_status))],
          ["Industry", via(q, "occupation_industry", `${answerLabel(engine, "occupation_industry", q.occupation_industry)}${q.occupationDetail ? `: ${q.occupationDetail}` : ""}`)],
          ["Annual income", via(q, "annual_income", answerLabel(engine, "annual_income", q.annual_income))], ["Net worth", via(q, "net_worth", answerLabel(engine, "net_worth", q.net_worth))], ["Declaration", yes(q.declaration)],
        ]} />
      </Card>
      <Card id="h-id" eyebrow="Declared by the applicant" title="Identity and address">
        <KV rows={[
          ...(level ? ([["Evidence level", `${levelConfig(deps.wallet.config, level).label}: ${levelConfig(deps.wallet.config, level).detail}`]] as [string, ReactNode][]) : []),
          ...(ev
            ? ([
                ["Credential", `${ev.credentialType}, issued by ${ev.issuer.name}`],
                ["Name in credential", `${ev.attributes.givenName} ${ev.attributes.familyName}`],
                ["Valid until", ev.attributes.documentExpiry ?? ev.credentialExpiresAt.slice(0, "yyyy-mm-dd".length)],
                ["Verified", `${ev.verifiedAt}. Passed: ${ev.checks.map((x) => x.replaceAll("_", " ")).join(", ")}`],
                ["Selfie", "Not required (ID wallet)"],
              ] as [string, ReactNode][])
            : ([["Document", `${humanize(i.docType)}, ${countryName(i.issuingCountry)}`], ["Expiry", i.noExpiry ? "No expiry date" : i.expiryDate], ["Selfie", i.selfie]] as [string, ReactNode][])),
          ["Address", [r.apartment, r.addressLine1, r.addressLine2, r.city, r.region, r.postcode, countryName(r.country)].filter(Boolean).join(", ")],
          ["Mobile", r.mobilePhone], ["Landline", r.landlinePhone], ["Proof of residence", humanize(r.porType)],
        ]} />
      </Card>
    </div>
  );
}

/** Who answered (spec 10 section 6, D23): shown to the analyst only; it never reaches the engine. */
const AGENT_LABEL: Record<string, string> = { interviewer: "AI assistant in the portal", mcp: "AI client over MCP" };
function intakeChannel(p: QuestionnaireData["provenance"]): string {
  if (!p) return "Form";
  const agents = [...new Set(Object.values(p).filter((e) => e.source !== "form").map((e) => (e.source === "mcp" && e.clientName ? `${AGENT_LABEL.mcp} (${e.clientName})` : AGENT_LABEL[e.source]!)))];
  return agents.length ? `Form, with answers drafted by ${agents.join(" and ")} and confirmed by the applicant` : "Form (assistant drafts were all edited by the applicant)";
}
function via(q: QuestionnaireData, field: string, value: ReactNode): ReactNode {
  const e = q.provenance?.[field];
  if (!e || e.source === "form") return value;
  return <>{value} <span className="muted">· drafted by {e.source === "mcp" ? (e.clientName ?? "an AI client") : "the AI assistant"}, confirmed</span></>;
}

function AuditTrail({ view }: { view: CaseView }) {
  const analysts = portalDeps().consoleConfig.analysts;
  return (
    <section aria-labelledby="h-audit" className="stack">
      <div className="card-head">
        <h2 id="h-audit" className="card-title">Audit trail</h2>
        <span className="muted">{view.trail.length} entries</span>
      </div>
      <ol className="audit-list">
        {view.trail.map((a) => (
          <li key={a.id}>
            <span className="when">{when(a.ts)}</span>
            <span className="who">{actorLabel(a.actor, analysts, a.action)}</span>
            <span className="what">{describe(a)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
