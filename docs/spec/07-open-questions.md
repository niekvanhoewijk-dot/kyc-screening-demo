# 07 — Open questions and assumptions

Add new ones here instead of guessing. Format: ID, question, current default, status.

| ID | Question | Current default | Status |
|---|---|---|---|
| O-1 | Threshold formula: is it min(deposit band max, SoF% x **income** band max, category cap)? Inferred from 3 examples. Doc text says "80% of the provided amount" while the examples apply 80% to the income band | Inferred formula (see 04) | Open, only the $100k ceiling confirmed |
| O-2 | Does the $100k ceiling apply after EDD? | No (the doc example reaches $160k) | Claude's reading, confirm |
| O-3 | SoF % for **pension** and **other** (not in the doc table) | 80% | Assumption |
| O-4 | Doc table lists "any income (rent)" 80% and "sold property" 100% but the questionnaire SoF options do not include them | Kept in config as `future_sof_percent` | Open |
| O-5 | Occupation/industry risk list ("the list is huge ... determined by the regulator") | 3 doc examples, others = medium | Needs Compliance input |
| O-6 | Country tiers for countries not on FATF/EU lists | default medium, "unassessed" | Replace via `CountryRiskProvider` |
| O-7 | EU sanctions map, UN and OFAC programmes to be loaded with `as_of` dates | empty list | Phase 1 |
| O-8 | Corporate questionnaire and company scoring factors (doc: "attaching a different document as an example", not provided) | Highest natural-person band + country of incorporation | Missing document |
| O-9 | Employment "Other"/"Unemployed" with a deposit: doc gives a $10k threshold; confirm intent for unemployed High-Risk clients | min of caps | Open |
| O-10 | Post-rejection process ("to be formulated" in the flow) | Message only + analyst note | Open |
| O-11 | Selfie and POI: separate steps or one capture? Supplier is external, not integrated | Selfie inside 2.1.4 via mock | Open |
| O-12 | Equality case in EDD (`covered == deposited`) | headroom 0 (`new_threshold` = deposited), as in spec 05; implemented in `src/engine/edd.ts`. **Note:** `tools/verify_golden.py` returns `return_excess_and_block` with excess 0 for this input. No golden case covers it, so both pass today | Open: confirm, then align the oracle and add a golden case |
| O-13 | Source docs are confidential (Ateaya / Omikron Financial Holdings Europe LTD, vendor pricing, Polis-X branding): what may be reused publicly? | Private, generic branding, synthetic data | Needs clearance before any sharing |
| O-14 | Thresholds and amounts are in USD in the doc; the Dutch/EU audience may expect EUR | USD as in the doc, currency in config | Open |
| O-15 | EDD recalculation: does the "only source of wealth" 80% rule apply to investment/inheritance SoF documents, as it does for the initial threshold? Spec 05 is silent; the oracle always uses the "not only wealth" rate | Engine accepts `only_source_of_wealth` (default false = oracle behaviour) | Open |
| O-16 | Minimum applicant age (18+?) is not stated in the requirements | Not enforced; DOB only has to be in the past | Open |
| O-17 | Selfie retries before escalation, OTP length/expiry/attempts, session length | 3 selfie attempts then flagged for the analyst (never auto-passed); OTP 6 digits, 10 min, 5 attempts; session 30 days. All in `config/portal.yaml` | Assumption |
| O-18 | US tax resident ("cannot be accepted") and FATF call-for-action countries: reject instantly in the portal, or route to the analyst? | Engine marks the case `reject`; the applicant sees the neutral 2.1.7 text and the analyst confirms. Keeps a human on every decision and avoids tipping off | Claude's default, confirm |
| O-19 | POI expiry date: entered by the applicant in Phase 2; Claude extraction in Phase 3 cross-checks it | Applicant-entered, validated not expired | Phase 3 |
| O-20 | Spec 06 asks for temperature 0; the default model (`claude-sonnet-5-5`) rejects non-default sampling values with a 400 | No temperature sent. Determinism for the demo comes from the replay cache, not sampling | Resolved by API constraint |
| O-21 | Spec 06 says "force a tool call"; forced `tool_choice` returns a 400 on current models | Structured outputs (`output_config.format`, Zod schema) give the same guarantee: schema-valid JSON, re-validated in code, retry once, then "extraction failed" | Resolved by API constraint |
| O-22 | Safety declines on document reading | Server-side refusal fallback (`fallbacks: "default"`) is on; the model that actually answered is logged per call. Set `refusal_fallbacks: off` in `config/document-reading.yaml` to disable | Default, confirm |
| O-23 | Which rule checks are hard "fail" vs "flag" | Dates and document categories enforced by code = fail (expired POI, POR > 3 months, mobile bill, envelope, P.O. box, missing address fields, selfie). Claude's visual judgements (corners, watermark, editing, unclear) and fuzzy matches (name, DOB, address, joint holder, prompt injection) = flag. The analyst decides either way | Default, confirm |
| O-24 | Labelled set uses SAMPLE-marked documents; the reader is told to ignore that marking for the watermark check | Prompt note in `src/documents/prompt.ts` | Demo-only, keep in mind for evals |
| O-25 | After EDD at onboarding (High / Auto-High, nothing deposited yet), what is the client's threshold? | The EDD recalculation's `new_threshold` (covered amount) replaces the initial threshold and is shown to the applicant; the initial $100k ceiling does not apply (O-2) | Claude's reading, confirm |
| O-26 | Confirmed sanctions screening match: hard reject? The requirements only say sanctions lists are screened | Approval is blocked; the analyst rejects with a reason. Not an engine rule (no config entry) | Default, confirm |
| O-27 | Confirmed PEP screening match vs self-declared PEP | Either one makes the client a PEP: the engine re-scores with PEP = yes (D9) and EDD becomes required | Default, confirm |
| O-28 | EDD trigger 2 (deposits reach the threshold) and `deposited_to_date` | The demo has no deposit ledger: the analyst enters deposited-to-date in the EDD recalculation | Demo limitation |
| O-29 | Analyst identity | Demo picker, no authentication; every action is audited under the chosen analyst | Demo limitation |
| O-30 | MVP 1 vs MVP 2 | MVP 1: Claude does not run at submission and its output is hidden. MVP 2: pre-review runs after submission and is shown as advisory. Analysts can run it on demand in MVP 2 | Default |
| O-31 | Company KYB: how do UBOs, shareholders and board members do their KYC? | The representative uploads each person's ID and proof of residence in the portal; only the representative takes a selfie. A per-person invite flow is out of scope for the demo | Default, confirm |
| O-32 | Deposit threshold for companies | Not defined in the requirements: none is computed or shown; EDD recalculation uses the company's declared source of funds | Open |
| O-33 | Company risk (O-8 default) in detail | Band = highest of the country-of-incorporation band and each person's band (residence country tier, PEP at least High). Corporate questionnaire answers (industry, deposits, SoF) are collected but not scored | Demo default, confirm |
| O-34 | Applicant-tagged document vs Claude classification disagree | The tag still counts for coverage; the disagreement is listed as an inconsistency for the analyst (Claude only flags) | Default |
| O-35 | Persons' own POI/POR in company cases are not read by Claude in the pre-review | Only the representative's POI/POR and the company documents are read; persons' documents are checked for presence | Demo scope |
| O-36 | Company entity screening | The company name is screened against the (person-only) demo watchlist; no entity list is seeded | Demo limitation |
| O-37 | Persona and labelled documents carry fixed dates (POR issued Sep 2026); the rules use today's date | Demo valid until about 2026-12-20 (Low persona POR turns older than 3 months). Regenerate documents and re-record after that | Demo maintenance |
| O-38 | Default DEMO_MODE | `replay` (offline, recorded responses only). Record scripts always call the API live | Default |
