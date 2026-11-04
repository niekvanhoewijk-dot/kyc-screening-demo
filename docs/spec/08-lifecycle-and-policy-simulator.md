# 08: Lifecycle and policy-change simulator (Phase 8)

Status: spec for Phase 8. Decisions D12 to D15 and open questions O-41 to O-50 are listed in section 8.
Read first: `00`, `04`, `05`, and `02` (POR rules). Everything here stays inside the existing principle: **the rules engine decides, Claude assists, a human takes the final decision.** Phase 8 adds no new Claude call.

## 1. What this adds and why it is worth building

Today the demo answers "what happens to this applicant?". Phase 8 answers the question regulators and auditors ask next:

1. **Which policy produced this outcome?** Every outcome gets a decision record (policy version, inputs, reason codes, timestamp), and the record can be replayed to the same result.
2. **What happens to customers I already have when the world or my policy changes?** A time-travel panel advances a simulated clock or injects an event and shows who is affected.
3. **What would this policy change do before I ship it?** A dry run shows who changes band, who needs EDD, who becomes prohibited.

Interview line: "Policy is data. Every decision is replayable. Before a policy change goes live you can see its blast radius."

## 2. Two corrections to the first framing (read before building)

**Time alone does not change a band.** Band depends on country, answers, PEP status and policy. Advancing the clock creates **obligations** (a POR notice, a POR expiry block, a periodic review that becomes due). Bands change only when a **fact** changes (an event) or the **policy** changes. The panel therefore has two outputs, shown side by side:

| Output | Driven by | Example |
|---|---|---|
| Obligations due | Clock | POR expires on 12 Mar; annual review overdue for an EDD customer |
| Band / route changes | Events and policy changes | Country leaves the FATF list; customer confirmed as PEP; policy knob flipped |

**"Higher-risk" in AMLR Art. 26(2) means customers subject to enhanced due diligence.** The text reads: the update interval "shall not in any case exceed" one year for customers subject to the Section 4 EDD measures, and five years for all others. In this demo, `edd_required = true` (High and Auto-High bands) maps to the one-year interval (O-43). The intervals are outer limits; policy may set shorter, never longer. Art. 26(3) adds event-driven reviews (a change in the customer's circumstances, or the firm learning a relevant fact). The Regulation applies from 10 July 2027, so before that date the demo labels these obligations **preview, not yet in force**.

## 3. Policy versioning

### 3.1 What a policy version is
A policy version is an immutable bundle: a risk matrix, a country list, and a settings block. It has an id (`P1`, `P2`, ...), an `effective_from` date, and a content hash (sha256 of the canonical JSON of everything it resolves to). Editing a knob in the UI creates a **draft** version for comparison; it never mutates a published one.

New file `config/policy/policies.yaml` (draft in this folder; Phase 8 wires it):

```yaml
policies:
  - id: P1
    label: "Full v3 baseline, FATF June 2026"
    effective_from: "2026-06-19"
    risk_matrix: risk-matrix.yaml
    country_list: country-risk.yaml          # list_version FATF-2026-06
    settings: { ... see 3.2 }
  - id: P2
    label: "FATF October 2026 plenary"
    effective_from: "2026-10-30"
    risk_matrix: risk-matrix.yaml
    country_list: policy/country-risk.2026-10.yaml   # list_version FATF-2026-10
    settings: { ... same as P1 }
```
The existing `config/country-risk.yaml` stays as the June list. Phase 8 may move it to `config/policy/` but must keep all current golden tests green.

### 3.2 Settings block (the knobs)
| Setting | Values | Default | Notes |
|---|---|---|---|
| `call_for_action_treatment` | `all_prohibited` / `follow_fatf` | `all_prohibited` | **The Myanmar knob.** Full v3: no client from a call-for-action jurisdiction. `follow_fatf`: entries with `action: countermeasures` (DPRK, Iran) resolve to Prohibited; entries with `action: edd` (Myanmar) resolve to Auto-High, so the customer is accepted only through EDD. Needs an optional `action` field on `fatf_call_for_action` entries (present in the October file). |
| `recently_delisted_treatment` | `normal_with_note` / `hold_auto_high` | `normal_with_note` | Delisting is not an automatic drop in risk. `normal_with_note` is today's behaviour (default tier, analyst note). `hold_auto_high` keeps a recently delisted country at Auto-High until the next review of the customer. |
| `periodic_review.enabled` | bool | `true` | Turns the lifecycle evaluation of reviews on. |
| `periodic_review.regulatory_effective_from` | date | `2027-07-10` | Before this date due reviews are flagged `preview`. |
| `periodic_review.interval_months` | `{edd: 12, standard: 60}` | as shown | Schema rejects `edd > 12` or `standard > 60`. |
| `por.notice_days_before_expiry` | int | existing `portal.yaml` value (spec 02: two weeks, configurable) | Reuse the existing setting; do not duplicate it. |

No numbers in code: all of the above come from config and are validated by Zod at load.

### 3.3 Country resolution change
`resolveCountry` takes the policy settings. Resolution order stays "first match wins" (spec 04 section 2) with two changes:
1. `fatf_call_for_action` entries resolve by `call_for_action_treatment` (above).
2. When `recently_delisted_treatment = hold_auto_high` and the country is in `recently_delisted`, it resolves to Auto-High with reason code `RC_COUNTRY_RECENTLY_DELISTED_HELD`.

`CountryResolution` gains `reason_code` and `policy_id`.

## 4. Decision records

### 4.1 When one is written
Every outcome, by the engine or by a person:

| Kind | Trigger |
|---|---|
| `engine.score` | First scoring at submission |
| `engine.rescore` | Re-score after a confirmed PEP match, an event, or a policy change |
| `engine.edd` | EDD recalculation |
| `analyst.approve` / `analyst.reject` / `analyst.edd` | Human decision (reason is mandatory, already enforced) |
| `lifecycle.por_notice`, `lifecycle.por_expired`, `lifecycle.review_due`, `lifecycle.threshold_reached` | Simulator or scheduler outcomes |
| `policy.dry_run`, `policy.applied` | Policy change evaluation (summary record, not per customer) |

### 4.2 Shape (Zod schema in `src/engine/decision-record.ts`)
```
DecisionRecord {
  id, case_id (or portfolio_id), seq,            // seq increases per subject
  kind,
  policy: { id, hash },
  inputs: { country, factor_answers, pep, us_tax_resident, deposited_to_date?, ... },   // no names, no document content
  outcome: { total, band, score_band, forced_by?, edd_required, threshold?, binding_limit?, route, status_from?, status_to? },
  reason_codes: string[],
  decided_by: "engine" | "analyst:<id>",
  analyst_reason?: string,
  at_wall: ISO, at_sim: ISO | null,              // at_sim only for simulator runs
  prev_hash, hash                                // hash chain per subject
}
```
Privacy: inputs carry only what the engine used. Never store names, document text or free-text answers. Applicants never see records or reason codes (D7, no tipping off).

### 4.3 Reason code catalogue (code, not prose, in records; the UI maps to labels)
Country: `RC_COUNTRY_CALL_FOR_ACTION_COUNTERMEASURES`, `RC_COUNTRY_CALL_FOR_ACTION_EDD`, `RC_COUNTRY_INCREASED_MONITORING`, `RC_COUNTRY_RECENTLY_DELISTED`, `RC_COUNTRY_RECENTLY_DELISTED_HELD`, `RC_COUNTRY_UNASSESSED`, `RC_COUNTRY_DEMO_SEED_LOW`.
Rules: `RC_US_TAX_RESIDENT`, `RC_PEP_FORCES_HIGH`, `RC_BAND_PROHIBITED`, `RC_BAND_EDD_REQUIRED`.
Threshold: `RC_THRESHOLD_DEPOSIT_BAND`, `RC_THRESHOLD_SOF_OF_INCOME`, `RC_THRESHOLD_CATEGORY_CAP`, `RC_THRESHOLD_HARD_CEILING`.
EDD: `RC_EDD_NEW_THRESHOLD`, `RC_EDD_EXCESS_RETURNED`, `RC_EDD_TERMINATED`.
Lifecycle: `LC_POR_EXPIRY_NOTICE`, `LC_POR_EXPIRED`, `LC_REVIEW_DUE_EDD_ANNUAL`, `LC_REVIEW_DUE_STANDARD_5Y`, `LC_THRESHOLD_REACHED`, `LC_CIRCUMSTANCE_CHANGE`, `LC_POLICY_CHANGE_REVIEW`.

### 4.4 Properties the tests must prove
1. **Replay:** for every record, `evaluate(record.inputs, policies[record.policy.id])` reproduces `record.outcome` and `reason_codes` exactly.
2. **Hash chain:** `npm run verify:records` recomputes every hash; altering any stored field makes it fail.
3. **Coverage:** every code path that sets a band, a threshold or a status writes a record (a test walks the seeded cases and checks each state change has one).
4. **Policy is pinned:** a record keeps pointing at the policy that produced it after a newer policy is published.

## 5. The simulator

### 5.1 Clock
A **simulated clock** stored as setting `sim.now` (null = real time). It is read only by the lifecycle evaluator and the simulator. It must **not** be used by OTP expiry, sessions, or intake validation (POR age at upload, POI expiry), which keep the wall clock (O-46). Reset restores real time.

### 5.2 Population ("book")
The six seeded cases alone will not show a policy change, because none of them lives in a country that left the list. The simulator evaluates a **book** made of:
1. the seeded cases (inputs read from their stored questionnaire / company data), and
2. `fixtures/portfolio/book.json`: about 18 **synthetic, engine-only** customers (no documents, no portal case), each with `country`, factor answers, `pep`, `onboarded_at`, `last_review_at`, `por_issued_at`, `por_expires_at`, `deposited_to_date`, `threshold`.

The book must include: customers in BG, CI, CD, MC (delisted in October), VN (watch item), MM, KP, IR, KE (still listed), GB, GR, NL (low), at least two PEPs, customers whose `last_review_at` falls on both sides of 12 and 60 months before 2027-07-10, one POR expiring within 14 days of the demo date, and one deposit just under its threshold. Label every one "Synthetic". Book rows appear only in the simulator, not in the analyst queue.

### 5.3 Pure functions (new, in `src/engine/lifecycle.ts`, no I/O)
```
evaluateCustomer(customer, policy, asOf)      -> { score, band, edd_required, threshold, route, reason_codes }
evaluateLifecycle(customer, policy, asOf)     -> Obligation[]   // por_notice, por_expired, review_due (flag: preview|in_force), ...
applyEvent(customer, event)                   -> customer'       // facts only
diffUnderPolicy(book, policyA, policyB, asOf) -> { rows: Change[], summary }
```
`Change` = `{ subject, before: {band, edd_required, threshold, route, reason_codes}, after: {...}, changed: ("band"|"edd"|"threshold"|"route")[] }`.

### 5.4 Events (inject)
| Event | Effect | Source in Full v3 / regulation |
|---|---|---|
| `deposit {amount}` | If `deposited_to_date >= threshold`: status to EDD requested, record `LC_THRESHOLD_REACHED` (reuses `depositTriggersEdd`) | Full v3 EDD trigger 2 |
| `por_replaced {issued_at}` | Clears expiry/notice | Full v3 POR rule |
| `circumstance_change {field, value}` | Country move, income band, employment; re-scores; record `LC_CIRCUMSTANCE_CHANGE` | AMLR Art. 26(3)(a) |
| `pep_confirmed` | Re-scores, band at least High (D9) | D9 |
| `list_change {policy_id}` | Switches the candidate policy; shows diff | FATF plenary |
| `edd_outcome {documented_annual_amount}` | Runs `recalculateEdd` | Full v3 EDD |

### 5.5 Rules for policy changes (D13)
- Default is a **dry run**: nothing is written except a `policy.dry_run` summary record.
- "Apply to demo data" re-scores the affected book rows and seeded cases, writes `engine.rescore` records pointing at the new policy, and is undone by the existing demo reset.
- **A policy change never auto-rejects or terminates an existing customer.** A customer who would become Prohibited under the new policy is routed to **analyst review** with `LC_POLICY_CHANGE_REVIEW`. Only a person closes a relationship (consistent with D8 and the "human decides" principle).
- New applicants are scored under the policy in force at submission, using the wall clock.

### 5.6 Screen (analyst console, new route `/analyst/simulator`, nav item "Simulator")
Follow the Phase 7 visual language (monochrome, Alexandria, 2px radius, bands as fill density plus text). Layout, top to bottom:

1. **Header**: title, "Illustrative demo" note, current simulated date with a "Reset to today" link.
2. **Clock controls**: date input; buttons `+14 days`, `+1 month`, `+1 year`, `Jump to AMLR switch-on (10 Jul 2027)`.
3. **Policy controls**: baseline policy select, candidate policy select, the knobs as labelled toggles (Myanmar rule, delisted countries), preset buttons for the scenarios (section 6).
4. **Event injector**: pick a customer, pick an event, fill its fields, `Inject`.
5. **Results**, two tiles at top: *Obligations due* (count, `preview` badge when before the effective date) and *Changes under candidate policy* (changed band / newly EDD / needs analyst review).
6. **Table**: subject, country, band before, band after, EDD before/after, threshold before/after, reason codes after, link to the decision record. Rows with no change collapse under "Unchanged (n)".
7. **Obligations list** with the date each falls due, the legal basis label (Full v3 POR rule, AMLR Art. 26(2)(a) or (b)) and the `preview` badge.
8. **Decision record drawer** for a subject: the chain, `Verify chain` button, and a `Replay` button that re-runs the record and shows "reproduced" or the difference.

Accessibility: tables with captions and scoped headers; every control labelled; no information by colour alone.

## 6 Scenarios (the demo script and the golden tests)

| # | Name | Setup | What the panel must show |
|---|---|---|---|
| S1 | FATF October 2026 plenary | Baseline P1 (June list), candidate P2 (October list), `recently_delisted_treatment = normal_with_note` | Book customers in BG, CI, CD, MC move from Auto-High to a lower band and lose the EDD requirement; nobody else changes. Flip the delisted knob to `hold_auto_high`: no one changes. Message: delisting is a policy question, not an automatic discount. |
| S2 | Myanmar knob | Candidate = P2 with `call_for_action_treatment = follow_fatf` | MM customers go from Prohibited to Auto-High (EDD, $40,000 category cap, accepted only through EDD); KP and IR stay Prohibited. Under the policy-change rule they appear as "analyst review", not automatic closure. |
| S3 | AMLR switch-on | Jump clock to 2027-07-10 | EDD-required customers with `last_review_at` more than 12 months old, and others more than 60 months old, show `LC_REVIEW_DUE_*`, badge `preview` the day before and `in force` from the date. |
| S4 | POR lifecycle | Advance to 14 days before a customer's `por_expires_at`, then to the expiry date | Notice `LC_POR_EXPIRY_NOTICE`, then `LC_POR_EXPIRED` and status `expired_por` (deposits and withdrawals blocked); `por_replaced` clears it. |
| S5 | Threshold reached | Inject a deposit that makes `deposited_to_date >= threshold` | `LC_THRESHOLD_REACHED`, route to EDD; then `edd_outcome` shows the recalculated threshold (spec 05). |

Expected numbers for S1 and S2 are **derived with the Python oracle** (`tools/verify_golden.py`, extended with a `scenarios` mode) before the TypeScript is written, then pinned in `tests/golden/scenarios.json`. Do not edit an expected value to make a test pass.

## 7 Data sources and what was verified (4 Nov 2026)
| Fact | Status |
|---|---|
| FATF 30 Oct 2026 plenary: Bulgaria, Cote d'Ivoire, DR Congo, Monaco removed from increased monitoring; no additions; list now 18 | Two independent secondary sources agree (ComplyAdvantage, RegReportingDesk). The FATF pages themselves could not be fetched from the research tool. **Re-check on fatf-gafi.org before an interview.** |
| Call for action unchanged: DPRK and Iran countermeasures; Myanmar enhanced due diligence only; FATF to consider countermeasures for Myanmar if no further progress by February 2027 | Same two sources |
| Vietnam: FATF "significant concern about the pace of progress", next steps if no tangible improvement by February 2027 | ComplyAdvantage |
| Next plenary February 2027 | Date unconfirmed |
| AMLR (EU) 2024/1624 Art. 26(2): max interval 1 year for customers subject to Section 4 EDD, 5 years for others; Art. 26(3) event-driven reviews | Article text (SPRINGLEX copy of the Official Journal text) |
| AMLR applies from 10 July 2027 | Widely reported; the demo labels pre-date obligations as preview |

The demo is not legal advice and not a compliance system. The EU high-risk third-country list and EU/UN/OFAC sanctions are still not modelled (`eu_sanctions_map: []`).

## 8 Decisions and open questions added by Phase 8
Decisions (Claude's defaults, change if wrong):
- **D12** Policy is versioned data; every outcome writes a replayable, hash-chained decision record.
- **D13** Policy change is a dry run by default and never auto-terminates a customer; it routes to analyst review.
- **D14** The Myanmar knob defaults to `all_prohibited` (Full v3 stays the source of truth, D4).
- **D15** AMLR periodic review is modelled with an effective date; before 10 July 2027 obligations show as `preview`.

Open questions O-41 to O-50 are appended to `07-open-questions.md`.

## 9 Out of scope for Phase 8
Real schedulers/cron (the simulator evaluates on demand), emailing customers, real money movement, the EU high-risk third-country list, per-customer risk-based review intervals shorter than the two legal maxima (the knob exists, no per-customer tuning), and any new Claude call.
