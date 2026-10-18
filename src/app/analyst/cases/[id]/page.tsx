import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { EddRequest, EddResultRecord } from "@/console/actions";
import { loadCaseView, type CaseView } from "@/console/case-view";
import { getMode } from "@/console/mode";
import type { Check } from "@/documents/checks";
import type { PreReview } from "@/documents/pre-review";
import type { PoiExtraction, PorExtraction } from "@/documents/schemas";
import type { BreakdownLine, CountryResolution, ThresholdResult } from "@/engine";
import { countryName } from "@/lib/countries";
import type { IdentityData, QuestionnaireData, ResidenceData } from "@/portal/cases";
import { portalDeps } from "@/portal/deps";
import type { EddSubmission } from "@/portal/edd";
import { PortalError } from "@/portal/errors";
import { decisionAction, eddRecalcAction, runPreReviewAction, startReviewAction, triageAction } from "../../actions";
import { ActionForm } from "../../action-form";
import { answerLabel, BAND_LABEL, STATUS_LABEL, usd } from "../../labels";

type Risk = { total?: number; band?: string; score_band?: string; forced_by?: string; breakdown?: BreakdownLine[]; country?: CountryResolution | null; edd_required?: boolean; decision?: string; reason?: string };

const Panel = ({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) => (
  <section className="panel">
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><h2>{title}</h2>{aside}</div>
    {children}
  </section>
);
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
  const risk = c.riskResult as Risk | null;
  return (
    <div className="stack">
      <div className="console-bar">
        <div>
          <Link href="/analyst" className="muted">← Queue</Link>
          <h1 style={{ marginTop: 4 }}>{applicant.firstName} {applicant.lastName}</h1>
          <span className="muted">{applicant.email} · submitted {c.submittedAt?.slice(0, 16).replace("T", " ") ?? "-"} UTC</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="pill">{STATUS_LABEL[c.status] ?? c.status}</span>
          {risk?.band && <span className={`pill ${risk.band}`}>{BAND_LABEL[risk.band]}</span>}
        </div>
      </div>
      {!["approved", "rejected"].includes(c.status) && <Routing risk={risk} />}
      <div className="grid">
        <ScorePanel risk={risk} engineVersions={c.engineVersions as Record<string, unknown> | null} />
        <div className="stack">
          <ThresholdPanel threshold={c.thresholdResult as ThresholdResult | null} edd={c.eddResult as EddResultRecord | null} />
          <DecisionPanel view={view} />
        </div>
      </div>
      <ScreeningPanel view={view} />
      <DocumentsPanel view={view} mode={mode} />
      {mode === "mvp2" && <PreReviewPanel caseId={c.id} pre={c.preReview as PreReview | null} />}
      <EddPanel view={view} />
      <AnswersPanel view={view} />
      <AuditPanel view={view} />
    </div>
  );
}

function Routing({ risk }: { risk: Risk | null }) {
  if (!risk) return null;
  if (risk.decision === "reject")
    return <div className="banner error">Engine hard rule: <strong>{risk.reason === "us_tax_resident" ? "US tax resident" : risk.reason === "prohibited_band" ? "prohibited (FATF call for action)" : risk.reason}</strong>. The client cannot be accepted; reject with a reason. The applicant sees only the neutral message (D7).</div>;
  if (risk.edd_required) return <div className="banner info">Band <strong>{BAND_LABEL[risk.band!]}</strong>{risk.forced_by === "pep" ? " (PEP)" : ""}: enhanced due diligence is required before approval.</div>;
  return null;
}

function ScorePanel({ risk, engineVersions }: { risk: Risk | null; engineVersions: Record<string, unknown> | null }) {
  const engine = portalDeps().engine;
  if (!risk) return <Panel title="Risk score"><p className="muted">Not scored.</p></Panel>;
  if (!risk.breakdown) return <Panel title="Risk score"><p>Not scored: hard rule <strong>{risk.reason}</strong> applies before scoring.</p></Panel>;
  const country = risk.country;
  return (
    <Panel title="Risk score (rules engine)" aside={<span className="muted">computed, not editable</span>}>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Factor</th><th>Answer</th><th>Tier</th><th style={{ textAlign: "right" }}>Points</th></tr></thead>
          <tbody>
            {risk.breakdown.map((b) => (
              <tr key={b.factor}>
                <td>{b.factor.replaceAll("_", " ")}</td>
                <td>{b.factor === "country" ? (country ? `${countryName(country.code)} (${country.code})` : "Fixture override") : answerLabel(engine, b.factor, b.answer)}</td>
                <td>{b.tier.replace("_", "-")}</td>
                <td style={{ textAlign: "right" }}>{b.points}</td>
              </tr>
            ))}
            <tr><td colSpan={3}><strong>Total</strong></td><td style={{ textAlign: "right" }}><strong>{risk.total}</strong></td></tr>
          </tbody>
        </table>
      </div>
      <KV rows={[
        ["Band", <>{BAND_LABEL[risk.band!]}{risk.forced_by === "pep" && <> (score band {BAND_LABEL[risk.score_band!]}, raised: PEP, D9)</>}</>],
        ["Country source", country ? <>{country.source}{country.unassessed ? "" : ""}, as of {country.as_of} <span className="muted">({country.list_version})</span>{country.unassessed && <> · <strong>unassessed</strong>, conservative default tier</>}</> : "Fixture"],
        ["Config", engineVersions ? <span className="muted">risk matrix v{String(engineVersions.risk_matrix_version)}, country list {String(engineVersions.country_list_version)}</span> : null],
      ]} />
    </Panel>
  );
}

function ThresholdPanel({ threshold, edd }: { threshold: ThresholdResult | null; edd: EddResultRecord | null }) {
  const LIMIT = { deposit_band: "Expected deposit band max", sof_of_income: "SoF % × income band max", category_cap: "Category cap", hard_ceiling: "Initial hard ceiling (D2)" } as const;
  return (
    <Panel title="Deposit threshold">
      {!threshold ? <p className="muted">None: the case cannot be accepted.</p> : (
        <>
          <p className="amount" style={{ margin: "0 0 6px" }}>{usd(threshold.threshold)}</p>
          <table>
            <tbody>
              {threshold.limits.map((l) => (
                <tr key={l.kind}><td>{LIMIT[l.kind]}{l.kind === threshold.binding && <> <span className="pill">binding</span></>}</td><td style={{ textAlign: "right" }}>{usd(Math.floor(l.value))}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {edd?.result.outcome === "new_threshold" && <p style={{ marginTop: 8 }}>After EDD: <strong>{usd(edd.result.new_threshold)}</strong> (headroom {usd(edd.result.headroom)}). The initial ceiling does not apply after EDD (O-2).</p>}
    </Panel>
  );
}

function DecisionPanel({ view }: { view: CaseView }) {
  const { c, actions } = view;
  if (actions.start_review.allowed)
    return (
      <Panel title="Decision">
        <p className="muted">Start the review to triage hits and decide. This is logged under your name.</p>
        <ActionForm key="start" action={startReviewAction} hidden={{ caseId: c.id }} submit="Start review" />
      </Panel>
    );
  if (["approved", "rejected"].includes(c.status))
    return (
      <Panel title="Decision">
        <KV rows={[["Outcome", STATUS_LABEL[c.status]], ["Reason", c.decisionReason], ["By", c.decidedBy], ["At", c.decidedAt?.slice(0, 16).replace("T", " ")]]} />
      </Panel>
    );
  const options = [
    ["approve", "Approve", actions.approve],
    ["edd", "Have further questions: request EDD", actions.request_edd],
    ["reject", "Reject", actions.reject],
  ] as const;
  const anyAllowed = options.some(([, , a]) => a.allowed);
  return (
    <Panel title="Decision">
      <ul style={{ paddingLeft: 18, margin: "0 0 10px", fontSize: 14 }}>
        {options.map(([id, label, a]) => <li key={id}>{label}: {a.allowed ? <span className="pill pass">available</span> : <span className="muted">{a.why}</span>}</li>)}
      </ul>
      {anyAllowed ? (
        <ActionForm key={`decide-${c.status}`} action={decisionAction} hidden={{ caseId: c.id }} submit="Record decision">
          <div className="inline-form">
            <select name="action" aria-label="Decision" defaultValue={options.find(([, , a]) => a.allowed)?.[0]}>
              {options.filter(([, , a]) => a.allowed).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
          <textarea name="reason" rows={2} placeholder="Reason (required, kept in the audit trail)" aria-label="Reason" />
        </ActionForm>
      ) : <p className="muted">Waiting for the applicant.</p>}
    </Panel>
  );
}

function ScreeningPanel({ view }: { view: CaseView }) {
  const reviewing = ["in_review", "edd_submitted"].includes(view.c.status);
  const provider = view.hits[0];
  return (
    <Panel title="Screening hits" aside={<span className="muted">{provider ? `${provider.provider}, ${provider.listVersion}` : "Demo watchlist (fictional)"}</span>}>
      {view.hits.length === 0 ? <p className="muted">No hits.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Entry</th><th>Category</th><th>Name</th><th>DOB</th><th>Country</th><th>Strength</th><th>Triage</th></tr></thead>
            <tbody>
              {view.hits.map((h) => {
                const m = h.match as { nameSimilarity: number; dob: string; country: string };
                return (
                  <tr key={h.id}>
                    <td>{h.entryName}<br /><span className="muted">{h.entryId} · {h.program}</span></td>
                    <td>{h.category.replace("_", " ")}</td>
                    <td>{Math.round(m.nameSimilarity * 100)}% similar</td>
                    <td>{m.dob.replace("_", " ")}</td>
                    <td>{m.country}</td>
                    <td><span className={`pill ${h.strength === "strong" ? "fail" : "flag"}`}>{h.strength}</span></td>
                    <td style={{ minWidth: 240 }}>
                      {h.status !== "open" ? <><strong>{h.status.replace("_", " ")}</strong><br /><span className="muted">{h.triageReason} ({h.triagedBy})</span></> : reviewing ? (
                        <ActionForm action={triageAction} hidden={{ caseId: view.c.id, hitId: h.id }} submit="Record">
                          <select name="verdict" aria-label="Verdict" defaultValue="false_positive">
                            <option value="false_positive">False positive</option>
                            <option value="true_match">True match</option>
                          </select>
                          <input name="reason" placeholder="Reason (required)" aria-label="Triage reason" style={{ width: "100%" }} />
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
      <p className="muted" style={{ marginTop: 8 }}>Only an analyst clears a hit. A confirmed PEP match re-scores the case as PEP (D9); a confirmed sanctions match blocks approval.</p>
    </Panel>
  );
}

const DOC_LABEL: Record<string, string> = { poi_front: "Proof of identity (front)", poi_back: "Proof of identity (back)", selfie: "Selfie", por: "Proof of residence", sof: "Source of funds", edd_kyc: "EDD: ID-holding photo" };

function DocImage({ d }: { d: CaseView["docs"][number] }) {
  const src = `/analyst/documents/${d.id}`;
  return d.mime.startsWith("image/")
    // eslint-disable-next-line @next/next/no-img-element
    ? <a href={src} target="_blank" rel="noreferrer"><img className="doc-thumb" src={src} alt={`${DOC_LABEL[d.kind]}: ${d.originalName}`} /></a>
    : <a href={src} target="_blank" rel="noreferrer">{d.originalName} (open PDF)</a>;
}

function Extraction({ reading }: { reading: CaseView["readings"]["poi"] }) {
  if (!reading) return <p className="muted">Claude has not read this document. Run the pre-review below.</p>;
  if (reading.status === "failed") return <div className="advisory"><p><strong>Extraction failed.</strong> {reading.error}</p><p className="muted">Review the document manually.</p></div>;
  const x = reading.extraction as PoiExtraction | PorExtraction;
  const fields = x.fields.map((f) => [f.field.replaceAll("_", " "), <>{f.value ?? <span className="muted">not found</span>} <span className={`pill ${f.confidence < portalDeps().checkRules.confidence_threshold ? "flag" : "pass"}`}>{Math.round(f.confidence * 100)}%</span> <span className="muted">{f.evidence}</span></>] as [string, ReactNode]);
  return (
    <div className="advisory stack">
      <span className="muted">Claude extraction · {reading.model} · {reading.promptVersion} · {reading.source}</span>
      <KV rows={[["Type", "document_type" in x ? x.document_type : x.document_category], ...fields, ["Issues", x.issues.join(", ") || "none"], ["Notes", x.issue_notes || null]]} />
    </div>
  );
}

function DocumentsPanel({ view, mode }: { view: CaseView; mode: string }) {
  const byKind = (k: string) => view.docs.filter((d) => d.kind === k);
  const face = view.faces.at(-1);
  const pair = (kinds: string[], reading: CaseView["readings"]["poi"]) => (
    <div className="doc-pair">
      <div className="stack">{kinds.flatMap(byKind).map((d) => <div key={d.id}><span className="muted">{DOC_LABEL[d.kind]}: {d.docType ?? ""}</span><DocImage d={d} /></div>)}</div>
      {mode === "mvp2" ? <Extraction reading={reading} /> : <p className="muted">MVP 1: check the document yourself. Switch to MVP 2 to see Claude&apos;s extraction beside it.</p>}
    </div>
  );
  return (
    <Panel title="Documents">
      <div className="stack">
        {pair(["poi_front", "poi_back"], view.readings.poi)}
        <div className="doc-pair">
          <div>{byKind("selfie").map((d) => <div key={d.id}><span className="muted">Selfie</span><DocImage d={d} /></div>)}</div>
          <KV rows={[["Face match", face ? `${face.provider}: liveness ${face.liveness}, match ${face.match} (${face.score})` : "not run"], ["Attempts", String(view.faces.length)]]} />
        </div>
        {pair(["por"], view.readings.por)}
        {byKind("sof").length + byKind("edd_kyc").length > 0 && (
          <div className="grid">{[...byKind("sof"), ...byKind("edd_kyc")].map((d) => <div key={d.id}><span className="muted">{DOC_LABEL[d.kind]}</span><DocImage d={d} /></div>)}</div>
        )}
      </div>
    </Panel>
  );
}

function PreReviewPanel({ caseId, pre }: { caseId: string; pre: PreReview | null }) {
  const order: Record<Check["status"], number> = { fail: 0, flag: 1, pass: 2 };
  return (
    <Panel title="Claude pre-review" aside={<span className="muted">Advisory only. The decision rests with the analyst.</span>}>
      {pre ? (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Check</th><th>Result</th><th>Reason codes</th><th>Detail</th><th>Source</th></tr></thead>
            <tbody>
              {[...pre.checks].sort((a, b) => order[a.status] - order[b.status]).map((x) => (
                <tr key={x.name}><td>{x.name.replaceAll("_", " ")}</td><td><span className={`pill ${x.status}`}>{x.status}</span></td><td>{x.reason_codes.join(", ")}</td><td>{x.detail}</td><td className="muted">{x.source}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Ran {pre.ranAt.slice(0, 16).replace("T", " ")} UTC. {pre.porValidUntil && <>POR valid until {pre.porValidUntil}.</>}</p>
        </div>
      ) : <p className="muted">Not run for this case yet.</p>}
      <ActionForm action={runPreReviewAction} hidden={{ caseId }} submit={pre ? "Run again" : "Run pre-review"} pending="Claude is reading…" />
    </Panel>
  );
}

function EddPanel({ view }: { view: CaseView }) {
  const { c, actions } = view;
  const req = c.eddRequest as EddRequest | null;
  if (!req) return null;
  const sub = c.eddSubmission as EddSubmission | null;
  const res = c.eddResult as EddResultRecord | null;
  const outcome = res?.result;
  return (
    <Panel title="Enhanced due diligence">
      <KV rows={[
        ["Requested", `${req.requestedAt.slice(0, 16).replace("T", " ")} by ${req.requestedBy}: ${req.reason}`],
        ["Asked for", <>Proof of source of funds · extra KYC {req.items.extraKyc === "already_satisfied" ? "already satisfied by the verified selfie" : "required"}</>],
        ["Applicant sent", sub ? `${sub.sofDocuments} SoF document(s)${sub.extraKyc ? " + ID-holding photo" : ""} on ${sub.submittedAt.slice(0, 10)}${sub.note ? `: "${sub.note}"` : ""}` : "Waiting for the applicant"],
        ["Engine result", outcome ? (
          outcome.outcome === "new_threshold" ? <>New threshold <strong>{usd(outcome.new_threshold)}</strong>, headroom {usd(outcome.headroom)}</>
          : outcome.outcome === "return_excess_and_block" ? <>SoF does not cover deposits: return <strong>{usd(outcome.excess_to_return)}</strong>, block further deposits, report to AML and Compliance</>
          : <>No SoF: return all funds (<strong>{usd(outcome.amount_to_return)}</strong>), terminate, report to AML and Compliance</>
        ) : null],
      ]} />
      {actions.recalculate_edd.allowed && (
        <ActionForm action={eddRecalcAction} hidden={{ caseId: c.id }} submit="Recalculate (rules engine)">
          <p className="muted" style={{ margin: 0 }}>Enter what the documents evidence. The engine applies the SoF percentage for {answerLabel(portalDeps().engine, "source_of_funds", (c.questionnaire as QuestionnaireData).source_of_funds).toLowerCase()} (spec 05).</p>
          <div className="inline-form">
            <label>Documented annual amount (USD) <input name="documentedAnnualAmount" inputMode="numeric" defaultValue={res?.input.documentedAnnualAmount ?? ""} /></label>
            <label>Deposited to date (USD) <input name="depositedToDate" inputMode="numeric" defaultValue={res?.input.depositedToDate ?? 0} /></label>
            <label className="choice"><input type="checkbox" name="noSof" defaultChecked={res ? res.input.documentedAnnualAmount === null : false} /> No source of funds provided</label>
          </div>
        </ActionForm>
      )}
    </Panel>
  );
}

function AnswersPanel({ view }: { view: CaseView }) {
  const engine = portalDeps().engine;
  const q = view.c.questionnaire as QuestionnaireData | null;
  const r = view.c.residence as ResidenceData | null;
  const i = view.c.identity as IdentityData | null;
  if (!q || !r || !i) return null;
  const yes = (b: boolean) => (b ? "Yes" : "No");
  return (
    <div className="grid">
      <Panel title="Questionnaire">
        <KV rows={[
          ["Date of birth", q.dateOfBirth], ["Nationality", countryName(q.nationality)], ["Language", q.preferredLanguage], ["Phone", q.phone],
          ["TIN", q.tin ?? <>none: {q.tinMissingReason}</>], ["US tax resident", yes(q.usTaxResident)], ["PEP (declared)", yes(q.pep)],
          ["Deposit 12m", answerLabel(engine, "deposit_12m", q.deposit_12m)], ["Source of funds", `${answerLabel(engine, "source_of_funds", q.source_of_funds)}${q.onlySourceOfWealth ? " (only source of wealth)" : ""}`],
          ["Employment", answerLabel(engine, "employment_status", q.employment_status)], ["Industry", `${answerLabel(engine, "occupation_industry", q.occupation_industry)}${q.occupationDetail ? `: ${q.occupationDetail}` : ""}`],
          ["Annual income", answerLabel(engine, "annual_income", q.annual_income)], ["Net worth", answerLabel(engine, "net_worth", q.net_worth)], ["Declaration", yes(q.declaration)],
        ]} />
      </Panel>
      <Panel title="Identity and address (declared)">
        <KV rows={[
          ["Document", `${i.docType}, ${countryName(i.issuingCountry)}`], ["Expiry", i.noExpiry ? "No expiry date" : i.expiryDate], ["Selfie", i.selfie],
          ["Address", [r.apartment, r.addressLine1, r.addressLine2, r.city, r.region, r.postcode, countryName(r.country)].filter(Boolean).join(", ")],
          ["Mobile", r.mobilePhone], ["Landline", r.landlinePhone], ["POR type", r.porType],
        ]} />
      </Panel>
    </div>
  );
}

function summarise(payload: unknown): string {
  if (payload === null || payload === undefined) return "";
  const p = payload as Record<string, unknown>;
  if ("outcome" in p && "inputHash" in p) return `${p.kind} attempt ${p.attempt}: ${p.outcome} · model ${p.model ?? "-"} · ${p.promptVersion} · input ${String(p.inputHash).slice(0, 12)}…`;
  const s = JSON.stringify(payload);
  return s.length > 220 ? `${s.slice(0, 220)}…` : s;
}

function AuditPanel({ view }: { view: CaseView }) {
  return (
    <Panel title="Audit trail" aside={<span className="muted">{view.trail.length} entries</span>}>
      <div className="table-scroll">
        <table className="audit">
          <thead><tr><th>Time (UTC)</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>
            {view.trail.map((a) => (
              <tr key={a.id}><td style={{ whiteSpace: "nowrap" }}>{a.ts.slice(0, 19).replace("T", " ")}</td><td>{a.actor.startsWith("applicant:") ? "applicant" : a.actor}</td><td>{a.action}</td><td><code>{summarise(a.payload)}</code></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
