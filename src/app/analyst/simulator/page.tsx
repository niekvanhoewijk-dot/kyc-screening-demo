import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { Band } from "@/components/band";
import { Submit } from "@/components/form";
import { applicants, cases } from "@/db/schema";
import { replayRecord, verifyChain, type Change, type DecisionRecord, type Obligation, type ReasonCode } from "@/engine";
import { countryName } from "@/lib/countries";
import { portalDeps } from "@/portal/deps";
import { recordsFor } from "@/records/store";
import { bookCustomers } from "@/simulator/book";
import { effectivePolicy, policySet } from "@/simulator/policies";
import { portfolio, PORTFOLIO_SUBJECT, simulatorView } from "@/simulator/service";
import { ActionForm } from "../action-form";
import { answerLabel, BAND_LABEL, usd } from "../labels";
import { applyAction, clockAction, dryRunAction } from "./actions";
import { EventForm } from "./event-form";
import { BASIS_LABEL, CHANGE_LABEL, KNOB_LABEL, OBLIGATION_LABEL, REASON_LABEL, ROUTE_LABEL } from "./labels";
import { choiceQuery, readChoice } from "./refs";

export const dynamic = "force-dynamic";

// Lifecycle and policy-change simulator (docs/spec/08 section 5.6), in the Phase 7 look.
// Read-only rendering: every change goes through a server action and the simulator service.

const FACTOR_LABEL: Record<string, string> = {
  deposit_12m: "Planned deposit (12 months)",
  source_of_funds: "Source of funds",
  employment_status: "Employment",
  occupation_industry: "Industry",
  annual_income: "Annual income",
  net_worth: "Net worth",
};

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const money = (n: number | null) => (n === null ? "None" : usd(n));
const yesNo = (b: boolean) => (b ? "Yes" : "No");
const codes = (rc: ReasonCode[]) => rc.map((c) => REASON_LABEL[c] ?? c);

function FlagChip({ flag }: { flag: Obligation["flag"] }) {
  return <span className="chip tag">{flag === "preview" ? "Preview, not yet in force" : "In force"}</span>;
}

export default async function SimulatorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const deps = portalDeps();
  const choice = readChoice(deps, (k) => sp[k]);
  const view = simulatorView(deps, choice.refs);
  const subjects = portfolio(deps);
  const book = bookCustomers(deps);
  const inForce = deps.policies.inForce(view.clock.date);
  const effective = effectivePolicy(deps);
  const amlr = inForce.policy.settings.periodic_review.regulatory_effective_from;
  const hidden = { baseline: choice.baselineParam, candidate: choice.candidateBase, cfa: choice.knobs.call_for_action_treatment, delisted: choice.knobs.recently_delisted_treatment };
  const link = (extra: Record<string, string> = {}) => `/analyst/simulator?${choiceQuery(choice, extra)}`;

  // Names for seeded cases (analyst-facing; records hold ids only).
  const caseIds = subjects.filter((s) => s.source === "case").map((s) => s.subject);
  const caseRows = caseIds.length
    ? deps.db.select({ id: cases.id, company: cases.company, first: applicants.firstName, last: applicants.lastName }).from(cases).innerJoin(applicants, eq(cases.applicantId, applicants.id)).where(inArray(cases.id, caseIds)).all()
    : [];
  const nameOf = (id: string) => {
    const c = caseRows.find((r) => r.id === id);
    if (c) return (c.company as { legalName?: string } | null)?.legalName ?? `${c.first} ${c.last}`;
    return id;
  };
  const noteOf = (id: string) => book.find((c) => c.id === id)?.note;
  const countryOf = (id: string) => {
    const s = subjects.find((x) => x.subject === id);
    if (!s) return "";
    const code = s.inputs.type === "individual" ? s.inputs.country : s.inputs.country_of_incorporation;
    return `${countryName(code)} (${code})`;
  };

  const changed = view.diff.rows.filter((r) => r.changed.length);
  const unchanged = view.diff.rows.filter((r) => !r.changed.length);
  const obligations = [...view.obligations].sort((a, b) => (a.due_on ?? "").localeCompare(b.due_on ?? ""));
  const shownKind = Object.keys(OBLIGATION_LABEL).includes(sp.ob ?? "") ? (sp.ob as Obligation["kind"]) : null;
  const shown = shownKind ? obligations.filter((o) => o.kind === shownKind) : obligations;
  const previews = obligations.filter((o) => o.flag === "preview").length;
  const s = view.diff.summary;
  const appliedHere = view.baseline.id !== inForce.policy.id && !choice.baselineParam;

  // Decision record drawer (item 8).
  const subject = sp.subject;
  const records: DecisionRecord[] = subject ? recordsFor(deps, subject) : [];
  const chainProblems = subject && sp.verify ? verifyChain(records) : null;
  const replayed = subject && sp.replay ? records.find((r) => String(r.seq) === sp.replay) : undefined;
  const replay = replayed ? replayRecord(replayed, policySet(deps), deps.kyb) : null;

  const rowsTable = (rows: Change[], caption: string) => (
    <div className="table-scroll" role="region" aria-label={caption} tabIndex={0}>
      <table className="tbl" style={{ minWidth: 980 }}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Customer</th>
            <th scope="col">Country</th>
            <th scope="col">Band before</th>
            <th scope="col">Band after</th>
            <th scope="col">EDD before → after</th>
            <th scope="col">Threshold before → after</th>
            <th scope="col">Reason codes after</th>
            <th scope="col">Records</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.subject}>
              <th scope="row">
                {view.sources[r.subject] === "case" ? <Link className="link" href={`/analyst/cases/${r.subject}`}>{nameOf(r.subject)}</Link> : <span className="strong">{r.subject}</span>}
                <span className="sub">{view.sources[r.subject] === "case" ? "Seeded case" : `Synthetic · ${noteOf(r.subject) ?? ""}`}</span>
              </th>
              <td>{countryOf(r.subject)}</td>
              <td><Band band={r.before.band} /></td>
              <td>
                <Band band={r.after.band} />
                {r.changed.length > 0 && <span className="sub">Changed: {r.changed.map((c) => CHANGE_LABEL[c]).join(", ")}</span>}
              </td>
              <td>{yesNo(r.before.edd_required)} → {yesNo(r.after.edd_required)}</td>
              <td>{money(r.before.threshold)} → {money(r.after.threshold)}</td>
              <td style={{ lineHeight: 1.5 }}>
                {r.analyst_review && <span className="chip fail" style={{ marginBottom: 6 }}>Analyst review</span>}
                <span className="sub" style={{ marginTop: 0 }}>{ROUTE_LABEL[r.after.route] ?? r.after.route}</span>
                <ul className="bullets" style={{ fontSize: 12, gap: 2 }}>{codes(r.after.reason_codes).map((c) => <li key={c}>{c}</li>)}</ul>
              </td>
              <td><Link className="link" href={`${link({ subject: r.subject })}#records`}>Records<span className="sr-only"> for {nameOf(r.subject)}</span></Link></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="muted">None.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      {/* 1. Header */}
      <header className="page-head">
        <div className="head" style={{ gap: 10 }}>
          <span className="eyebrow">Lifecycle and policy · Illustrative demo</span>
          <h1 className="title">Simulator</h1>
          <p className="lede" style={{ fontSize: 15, maxWidth: 720 }}>
            A synthetic book of {book.length} customers plus the seeded cases. Time creates obligations; only a new fact or a policy change moves a band. Policy changes are a dry run unless you apply them to demo data, and they never close a relationship.
          </p>
        </div>
        <div className="stack" style={{ gap: 8, alignItems: "flex-start" }}>
          <span className="eyebrow">Simulated date</span>
          <span className="card-title">{day(view.clock.date)}{!view.clock.simulated && <span className="muted"> (today)</span>}</span>
          {view.clock.simulated && <span className="muted">Simulator only: sign-in, uploads and new applicants keep the real date.</span>}
          {view.clock.simulated && <ActionForm action={clockAction} hidden={{ op: "reset" }} submit="Reset to today" variant="outline" pending="Resetting…" className="stack tight" />}
        </div>
      </header>

      {/* 5. Results tiles */}
      <section className="tiles" aria-label="Results">
        <div className="tile">
          <span className="eyebrow">Obligations due</span>
          <span className="value">{obligations.length}</span>
          <span className="note">{previews ? `${previews} preview: AMLR applies from ${day(amlr)}` : "All in force"}</span>
        </div>
        <div className="tile">
          <span className="eyebrow">Changes under candidate</span>
          <span className="value">{s.changed} of {s.customers}</span>
          <span className="note">{s.band_changed} band · {s.newly_edd} newly EDD · {s.no_longer_edd} no longer EDD · {s.analyst_review} analyst review</span>
        </div>
      </section>

      <div className="cards-row">
        {/* 2. Clock controls */}
        <section className="card" aria-labelledby="clock-h">
          <div className="card-head"><div><span className="eyebrow">Clock</span><h2 className="card-title" id="clock-h">Move the simulated date</h2></div></div>
          <ActionForm action={clockAction} hidden={{ op: "set" }} submit="Set date" variant="outline" pending="Setting…" className="stack">
            <div className="field">
              <label htmlFor="sim-date">Date</label>
              <input id="sim-date" name="date" type="date" defaultValue={view.clock.date} required />
            </div>
          </ActionForm>
          <ActionForm
            action={clockAction}
            hidden={{ op: "step" }}
            buttons={<div className="actions tight">{deps.consoleConfig.simulator.clock_steps.map((st, i) => <Submit key={st.label} name="step" value={String(i)} arrow={false} variant="outline" pending="Moving…">{st.label}</Submit>)}</div>}
          />
          <ActionForm action={clockAction} hidden={{ op: "set", date: amlr }} submit={`Jump to AMLR switch-on (${day(amlr)})`} pending="Moving…" />
          <p className="foot-note">The simulated date is read only here and by the lifecycle evaluation. Each obligation is recorded once, when it first falls due.</p>
        </section>

        {/* 3. Policy controls */}
        <section className="card" aria-labelledby="policy-h">
          <div className="card-head"><div><span className="eyebrow">Policy</span><h2 className="card-title" id="policy-h">Compare two policies</h2></div></div>
          {appliedHere && <div className="banner">Applied in the simulator: <strong>{view.baseline.id}</strong> (demo data only). New applicants are still scored under the policy in force, {inForce.policy.id}.</div>}
          <form method="get" action="/analyst/simulator" className="stack">
            <div className="row">
              <div className="field">
                <label htmlFor="baseline">Baseline</label>
                <select id="baseline" name="baseline" defaultValue={choice.baselineParam}>
                  <option value="">Current book policy ({effective.policy.id})</option>
                  {deps.policies.all.map((p) => <option key={p.policy.id} value={p.policy.id}>{p.policy.id}: {p.policy.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="candidate">Candidate</label>
                <select id="candidate" name="candidate" defaultValue={choice.candidateBase}>
                  {deps.policies.all.map((p) => <option key={p.policy.id} value={p.policy.id}>{p.policy.id}: {p.policy.label}</option>)}
                </select>
              </div>
            </div>
            <fieldset className="field">
              <legend>Myanmar rule (call for action, enhanced due diligence only)</legend>
              {Object.entries(KNOB_LABEL.call_for_action_treatment).map(([v, l]) => (
                <label key={v} className="choice"><input type="radio" name="cfa" value={v} defaultChecked={choice.knobs.call_for_action_treatment === v} />{l}</label>
              ))}
            </fieldset>
            <fieldset className="field">
              <legend>Recently delisted countries</legend>
              {Object.entries(KNOB_LABEL.recently_delisted_treatment).map(([v, l]) => (
                <label key={v} className="choice"><input type="radio" name="delisted" value={v} defaultChecked={choice.knobs.recently_delisted_treatment === v} />{l}</label>
              ))}
            </fieldset>
            <div className="actions tight">
              <button className="btn small" type="submit">Compare</button>
              <Link className="link" href="/analyst/simulator">Clear</Link>
            </div>
          </form>
          <dl className="kv">
            <dt>Baseline</dt>
            <dd>{view.baseline.id}, {view.baseline.list_version} as of {view.baseline.as_of} · hash {view.baseline.hash.slice(0, 12)}</dd>
            <dt>Candidate</dt>
            <dd>{view.candidate.id}{view.candidate.id.includes("-draft-") && <> <span className="chip tag">Draft</span></>}, {view.candidate.list_version} as of {view.candidate.as_of} · hash {view.candidate.hash.slice(0, 12)}</dd>
          </dl>
          <div className="cols" style={{ gap: 20 }}>
            <ActionForm action={dryRunAction} hidden={hidden} submit="Dry run" pending="Running…">
              <p className="hint">Writes one summary record. Nothing else changes.</p>
            </ActionForm>
            <ActionForm action={applyAction} hidden={hidden} submit="Apply to demo data" variant="outline" pending="Applying…">
              <div className="field">
                <label htmlFor="apply-reason">Reason</label>
                <textarea id="apply-reason" name="reason" rows={2} required />
              </div>
              <p className="hint">Re-scores changed customers and seeded cases under the candidate. Would-be rejections go to analyst review. Undone by the demo reset.</p>
            </ActionForm>
          </div>
          <p className="foot-note">Country data: FATF lists with their as-of dates, re-checked against secondary sources only (O-49). Presented as what if, never as advice.</p>
        </section>
      </div>

      {/* 4. Event injector */}
      <section className="card" aria-labelledby="event-h">
        <div className="card-head"><div><span className="eyebrow">Events</span><h2 className="card-title" id="event-h">Inject an event</h2></div></div>
        <EventForm
          simDate={view.clock.date}
          customers={book.map((c) => ({ id: c.id, label: `${c.id} · ${countryName(c.country)} · Synthetic` }))}
          factors={Object.entries(FACTOR_LABEL).map(([id, label]) => {
            const f = deps.engine.matrix.factors[id as keyof typeof deps.engine.matrix.factors];
            const list = Array.isArray(f) ? f : f.values;
            return { id, label, options: list.map((v) => ({ id: v.id, label: answerLabel(deps.engine, id, v.id) })) };
          })}
        />
        <p className="foot-note">Events change a synthetic customer&apos;s facts only. The rules engine re-scores and records the outcome; seeded cases are applicants and take no events.</p>
      </section>

      {/* 6. Before / after table */}
      <section className="stack" aria-labelledby="changes-h">
        <div className="head" style={{ gap: 6 }}>
          <span className="eyebrow">{view.baseline.id} → {view.candidate.id}</span>
          <h2 className="section-title" id="changes-h">Changes under the candidate policy ({changed.length})</h2>
        </div>
        {rowsTable(changed, `Customers whose band, EDD requirement, threshold or route changes from ${view.baseline.id} to ${view.candidate.id}`)}
        <details>
          <summary className="link" style={{ display: "inline-block", padding: "8px 0" }}>Unchanged ({unchanged.length})</summary>
          {rowsTable(unchanged, "Customers with no change")}
        </details>
      </section>

      {/* 7. Obligations */}
      <section className="stack" aria-labelledby="obligations-h">
        <div className="head" style={{ gap: 6 }}>
          <span className="eyebrow">On {day(view.clock.date)}, under {view.baseline.id}</span>
          <h2 className="section-title" id="obligations-h">Obligations due ({obligations.length})</h2>
        </div>
        <form method="get" action="/analyst/simulator#obligations-h" className="filters">
          {Object.entries({ ...hidden, ...(subject ? { subject } : {}) }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div className="field">
            <label htmlFor="ob">Show</label>
            <select id="ob" name="ob" defaultValue={shownKind ?? ""}>
              <option value="">All obligations</option>
              {Object.entries(OBLIGATION_LABEL).map(([k, l]) => <option key={k} value={k}>{l} ({obligations.filter((o) => o.kind === k).length})</option>)}
            </select>
          </div>
          <div className="actions tight"><button className="btn small" type="submit">Show</button></div>
        </form>
        <ul className="audit-list">
          {shown.map((o) => (
            <li key={`${o.subject}-${o.code}`}>
              <span className="when">{o.due_on ? `Due ${day(o.due_on)}` : "Due now"}</span>
              <span className="who"><Link className="link" href={`${link({ subject: o.subject })}#records`}>{o.subject}</Link></span>
              <span className="what">
                <strong>{OBLIGATION_LABEL[o.kind]}:</strong> {REASON_LABEL[o.code]}. {BASIS_LABEL[o.basis]}. <FlagChip flag={o.flag} />
                {o.effect?.status === "expired_por" && <span className="sub">Deposits and withdrawals blocked until a new proof of residence.</span>}
                {o.effect?.status === "edd_requested" && <span className="sub">Routed to EDD.</span>}
              </span>
            </li>
          ))}
          {shown.length === 0 && <li className="muted">Nothing due on this date.</li>}
        </ul>
      </section>

      {/* 8. Decision record drawer */}
      <section className="card" id="records" aria-labelledby="records-h" tabIndex={-1}>
        <div className="card-head">
          <div>
            <span className="eyebrow">Decision records</span>
            <h2 className="card-title" id="records-h">{subject ? (subject === PORTFOLIO_SUBJECT ? "Portfolio: dry runs and applies" : `${nameOf(subject)}${view.sources[subject] === "book" ? " (Synthetic)" : ""}`) : "Pick a customer"}</h2>
          </div>
          <div className="actions tight">
            <Link className="link" href={`${link({ subject: PORTFOLIO_SUBJECT })}#records`}>Portfolio records</Link>
            {subject && <Link className="link" href={`${link()}#records`}>Close</Link>}
          </div>
        </div>
        {!subject && <p className="muted">Choose Records on a row or an obligation to see that customer&apos;s hash-chained decision records, verify the chain and replay a record.</p>}
        {subject && (
          <>
            <form method="get" action="/analyst/simulator#records" className="actions tight">
              {Object.entries({ ...hidden, subject }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <button className="btn small" type="submit" name="verify" value="1">Verify chain</button>
              <span className="muted">{records.length} record{records.length === 1 ? "" : "s"}</span>
            </form>
            {chainProblems && (
              <div className={`banner ${chainProblems.length ? "error" : "ok"}`} role="status">
                {chainProblems.length ? <>Chain broken: {chainProblems.map((p) => `record ${p.seq}: ${p.problem}`).join("; ")}.</> : <>Chain intact: every hash recomputed and every link checked ({records.length} records).</>}
              </div>
            )}
            {replay && replayed && (
              <div className={`banner ${replay.reproduced ? "ok" : "error"}`} role="status">
                Record {replayed.seq} ({replayed.kind}) {replay.reproduced ? <>reproduced under {replayed.policy.id}: same outcome, same reason codes.</> : <>differs: {replay.differences.join("; ")}</>}
              </div>
            )}
            <ol className="audit-list" style={{ paddingLeft: 0 }}>
              {records.map((r) => (
                <li key={r.id}>
                  <span className="when">#{r.seq} · {r.at_sim ? `Simulated ${day(r.at_sim)}` : new Date(r.at_wall).toISOString().slice(0, 10)}</span>
                  <span className="who">{r.kind}<span className="sub">{r.decided_by} · {r.policy.id}</span></span>
                  <span className="what">
                    {r.outcome.band !== undefined && <>Band {r.outcome.band ? (BAND_LABEL[r.outcome.band] ?? r.outcome.band) : "none"}{r.outcome.route ? `, ${ROUTE_LABEL[r.outcome.route] ?? r.outcome.route}` : ""}{r.outcome.threshold != null ? `, threshold ${usd(r.outcome.threshold)}` : ""}. </>}
                    {r.outcome.edd_outcome === "new_threshold" && <>EDD: new threshold {usd(r.outcome.threshold ?? 0)}, headroom {usd(r.outcome.amount ?? 0)}. </>}
                    {r.outcome.edd_outcome === "return_excess_and_block" && <>EDD: {usd(r.outcome.amount ?? 0)} to be returned, account blocked. </>}
                    {r.outcome.edd_outcome === "return_all_and_terminate" && <>EDD: no source of funds, {usd(r.outcome.amount ?? 0)} to be returned. </>}
                    {r.outcome.obligation && <>{REASON_LABEL[r.outcome.obligation.code as ReasonCode] ?? r.outcome.obligation.code}{r.outcome.obligation.due_on ? `, due ${day(r.outcome.obligation.due_on)}` : ""}. </>}
                    {r.outcome.summary && <>{r.outcome.summary.changed} of {r.outcome.summary.customers} change, {r.outcome.summary.analyst_review} to analyst review. </>}
                    {r.outcome.status_to && <>Status → {r.outcome.status_to.replace(/_/g, " ")}. </>}
                    {r.analyst_reason && <>Reason: {r.analyst_reason}. </>}
                    {r.reason_codes.length > 0 && (r.outcome.band !== undefined || r.outcome.summary) && <span className="sub">{codes(r.reason_codes).join(" · ")}</span>}
                    <span className="sub">hash {r.hash.slice(0, 12)} · previous {r.prev_hash ? r.prev_hash.slice(0, 12) : "none"}</span>
                    <form method="get" action="/analyst/simulator#records" style={{ marginTop: 6 }}>
                      {Object.entries({ ...hidden, subject }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                      <button className="link-btn" type="submit" name="replay" value={String(r.seq)}>Replay<span className="sr-only"> record {r.seq}</span></button>
                    </form>
                  </span>
                </li>
              ))}
              {records.length === 0 && <li className="muted">No records yet for this subject.</li>}
            </ol>
          </>
        )}
      </section>
      <p className="muted">Synthetic customers and seeded personas, all fictional. Not a regulated compliance system and not legal advice.</p>
    </>
  );
}
