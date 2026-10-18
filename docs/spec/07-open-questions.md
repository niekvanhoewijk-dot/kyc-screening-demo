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
| O-12 | Equality case in EDD (`covered == deposited`) | headroom 0 | Open |
| O-13 | Source docs are confidential (Ateaya / Omikron Financial Holdings Europe LTD, vendor pricing, Polis-X branding): what may be reused publicly? | Private, generic branding, synthetic data | Needs clearance before any sharing |
| O-14 | Thresholds and amounts are in USD in the doc; the Dutch/EU audience may expect EUR | USD as in the doc, currency in config | Open |
