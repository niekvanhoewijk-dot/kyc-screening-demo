# 00 — Scope and decisions

Source of logic: Ateaya KYC-KYB-AML Requirements **Full v3** (13 Jun 2024). Flow: "DVAULT Customer Experience Flows & Service Design Blueprint" (18/06/2024, draft v1). Lite (v2, 18 Jun) is the vendor-facing cut without scoring or thresholds and is **not** a logic source.

## Scope: full design
- Customer types: private individuals (incl. high-net-worth) and companies.
- Steps: account creation, email OTP, overview, POI, POR, questionnaire and risk scoring, check, decision, EDD, confirmation.
- Two views: **Applicant portal** and **Analyst console**.
- Two modes (flow "Operational Orchestration" lane): **MVP 1** manual checks by designated people; **MVP 2** automated checks with Claude pre-review. A toggle in the demo.
- Out of scope: wallet connection (flow 2.2, "KYC/KYB on wallet vendor side"), investing (4), customer support, CRM, channels, real vendor integrations, real payments.
- Deployment: **private, runs locally** on the laptop.

## Confirmed by Niek
| # | Topic | Decision |
|---|---|---|
| D1 | Score bands | Low 1-9, Medium 10-15, **High 16-29**, Auto-High 30-99, Prohibited 100+ (closes the doc's gaps at 16 and 22-29) |
| D2 | Threshold | Hard ceiling **$100,000** on the *initial* threshold. The rest of the formula is inferred (see 04). EDD may raise it beyond $100k, as the doc's own example reaches $160k. This reading of D2 (ceiling not applying after EDD) is Claude's, to be confirmed |
| D3 | Country risk | Seeded from the FATF black and grey lists (verified, as of 19 Jun 2026). LSEG publishes no per-country list; a real feed plugs in via `CountryRiskProvider` |
| D4 | Source of truth | Full v3, full design |
| D5 | Selfie | Required. External supplier, not integrated: `FaceMatchProvider` mock |
| D6 | Deployment | Private / local |

## Defaults chosen by Claude (change if wrong)
| # | Topic | Default |
|---|---|---|
| D7 | No-go message | Neutral, no reasons: "We're unable to open an account for you at this time. This follows from our regulatory requirements. If you think this is a mistake, contact support." |
| D8 | Decision node (corrected after reading the flow image) | Three outcomes: **Yes** (approved) -> 2.1.8 Confirmation; **Have further questions** -> EDD, then back to 2.1.8; **No** -> no-go message (D7) |
| D9 | PEP | PEP = band at least High (doc: "PEPs are High-Risk"). Acceptance is the analyst's call (doc: "depends on the company") |
| D10 | POR | One document, issued within 3 months, four corners visible; P.O. box, mobile phone bill and envelope/parcel photos rejected |
| D12 | Policy and decision records (Phase 8) | Policy is versioned data; every outcome writes a replayable, hash-chained decision record (policy version, inputs, reason codes, timestamps). Spec 08 |
| D13 | Policy change (Phase 8) | Dry run by default. A policy change never auto-rejects or terminates an existing customer: affected customers are routed to analyst review |
| D14 | Call-for-action treatment (Phase 8) | Policy setting. Default `all_prohibited` (Full v3, D4). `follow_fatf` accepts Myanmar-type entries (FATF: enhanced due diligence) through EDD only |
| D15 | AMLR periodic review (Phase 8) | Modelled with the effective date 10 Jul 2027; earlier results are labelled preview. EDD customers 12 months, others 60 months (outer limits of Art. 26(2)) |

## Resolved doc ambiguities
- Selfie "TBC" -> required (D5).
- POR "X number from the following (TBC)" -> one (D10).
- Score band gaps -> D1.
- Lite vs Full -> Full.
