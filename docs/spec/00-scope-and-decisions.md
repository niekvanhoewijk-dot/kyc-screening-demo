# 00 — Scope and decisions

Source of logic: Ateaya KYC-KYB-AML Requirements **Full v3** (13 Jun 2024). Flow: "DVAULT Customer Experience Flows & Service Design Blueprint" (18/06/2024, draft v1). Lite (v2, 18 Jun) is the vendor-facing cut without scoring or thresholds and is **not** a logic source.

## Scope: full design
- Customer types: private individuals (incl. high-net-worth) and companies.
- Steps: account creation, email OTP, overview, POI, POR, questionnaire and risk scoring, check, decision, EDD, confirmation.
- Two views: **Applicant portal** and **Analyst console**.
- Two modes (flow "Operational Orchestration" lane): **MVP 1** manual checks by designated people; **MVP 2** automated checks with Claude pre-review. A toggle in the demo.
- Out of scope: crypto wallet connection (flow 2.2, "KYC/KYB on wallet vendor side"; not the ID wallet of Phase 9), investing (4), customer support, CRM, channels, real vendor integrations, real payments.
- Agent access (Phase 10, spec 10): an interviewer in the portal and MCP servers for applicants and analysts, for individuals only. Agents never decide.
- Deployment: **private, runs locally** on the laptop. A public URL for the MCP servers (Phase 10d) is for replay-only demos with synthetic data (O-84).

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
| D16 | Wallet-first intake (Phase 9) | An ID wallet presentation (SD-JWT VC PID, test mode) can replace document capture and the selfie for individuals. Documents stay available. Spec 09 |
| D17 | Evidence-assurance level (Phase 9) | Derived by code from stored evidence, recorded and shown to the analyst. It is not an engine input and never changes the score, threshold or decision |
| D18 | What the wallet does not replace (Phase 9) | Questionnaire, screening, risk score, source of funds and EDD still run. Proof of residence is still required |
| D19 | Agent intake channels (Phase 10) | An in-portal interviewer and an applicant-side MCP server can collect the questionnaire answers for individuals. They use the same service layer as the forms. The applicant confirms every answer on the review page, ticks the declaration and submits on portal pages. Spec 10 |
| D20 | Agent boundaries (Phase 10) | Agents collect and explain. They cannot score, decide, submit, tick the declaration, request EDD or clear a screening hit. Identity, selfie, residence and review stay on portal pages, reached by an inline card or a link. No file bytes and no ID attributes pass through a model or an AI client |
| D21 | Tool registry is the contract (Phase 10) | One registry of tools with strict Zod input and output schemas feeds both the interviewer (native tool use) and the MCP servers. Outputs are allow-listed by schema. A test scans outputs and descriptions for score, band, reason and screening terms |
| D22 | MCP SDK dependency (Phase 10) | `@modelcontextprotocol/sdk` is approved as the one new dependency for Phase 10. This was taken as accepted from "build them all" in the planning chat on 10 Nov 2026. Change it here if wrong (fallback: a thin hand-written handler, O-82). Anything else new still needs approval |
| D23 | Provenance and channel (Phase 10) | Each answer records its source (`form`, `interviewer`, `mcp`) and the client name. The analyst sees the channel. Like the evidence level in D17, it is not an engine input and never changes the score, threshold or decision |
| D24 | Analyst MCP server is read-only (Phase 10) | Five read tools. No decision, EDD, hit-clearing, policy or simulator tool, now or later. Applicant-authored text is returned inside an `untrusted` envelope |

## Resolved doc ambiguities
- Selfie "TBC" -> required (D5).
- POR "X number from the following (TBC)" -> one (D10).
- Score band gaps -> D1.
- Lite vs Full -> Full.
