# 5-minute demo script

Illustrative demo on synthetic data. Not a regulated compliance system. Say so in the first sentence.

## Before the call (2 minutes, once)
1. `npm install`, then `cp .env.example .env.local` (keeps `DEMO_MODE=replay`: no API key, no network).
2. `npm run demo:reset`: seeds 6 synthetic cases. `npm run dev`, open `localhost:3000/analyst`, choose **Analyst One**. Mode: **MVP 1**.
3. Claude panels replay recorded responses. If `/analyst/demo` says nothing is recorded, run `npm run demo:record` once with a key in `.env.local` (live calls, a few dollars at most). Without recordings, demo MVP 2 from the tests and the eval report instead.
4. Second tab: `localhost:3000/apply`.

## The 5 minutes
| Time | Show | Say |
|---|---|---|
| 0:00 | Home page, "Illustrative demo" badge | Vendors cover ID and address checks. The questionnaire, risk score, threshold and EDD orchestration are what you still build. Rules decide, Claude assists, a person decides. |
| 0:30 | `/apply`: account, OTP (server console), overview, stepper | Every step resumable; error states on each screen; the applicant never sees score, PEP or screening reasons. |
| 1:15 | Queue: Low, Medium, High, Auto-High, Prohibited, Company | Five personas from the requirements' worked examples. The engine scored them at submission. |
| 1:30 | **Ada Sample (Low 8)**: score breakdown, "FATF, as of 2026-06-19", threshold $19,999 with the binding limit | No numbers in code: points, bands, caps and country lists live in YAML with source and date. 18 golden cases equal a Python oracle. |
| 2:00 | Ada's screening hit "Ada Sampel": start review, mark false positive with reason, approve | Only a person clears a hit. Every action needs a reason and lands in the audit trail. |
| 2:30 | **Petros Demopoulos (High, PEP)**: approve is blocked, "EDD must be completed" | D9: PEP means at least High. The engine sets what is possible; the analyst decides within it. EDD reproduces the doc example: $200k salary evidenced, $100k deposited, new threshold $160k. |
| 3:00 | **Sam Nemune (Prohibited 107)**: only reject available | FATF call-for-action. The applicant sees one neutral sentence (D7, no tipping off). |
| 3:20 | Switch to **MVP 2** | Same rules, same audit trail. MVP 1 is the manual process that already works; MVP 2 adds Claude. |
| 3:30 | **Tom Example (Medium 15)**: Claude pre-review: proof of residence older than 3 months, POI fields with confidence and evidence | Claude extracts and reports; code enforces dates and document types; low confidence never auto-passes. Document text is untrusted input. |
| 4:00 | Claude memo on any case: advisory, under the engine routing, restatement copied by code | Structured output, schema-validated, retried once; model, prompt version and input hash logged per call. |
| 4:20 | **Sample Holdings B.V.**: people and bands, KYB gap list, "uploaded as / reads as" | Company risk is a stated demo default (O-8). The gap list is code over declared data and Claude's classifications. |
| 4:40 | Audit trail at the bottom of a case; `reports/eval-*.md` | Precision and recall per reason code and cost per case, measured on a labelled synthetic set instead of anecdotes. Swapping a vendor touches an adapter, not the scoring. |

## If something goes wrong
- Anything odd on screen: `/analyst/demo`, type RESET (about 2 seconds, offline).
- A Claude panel says "not recorded": the run is in replay without that recording. Say so and move on to the rules engine; it is the part that decides.
- Persona proof-of-residence dates are fixed (September 2026). After about 20 December 2026 the Low persona's POR also becomes older than 3 months: regenerate with `npm run docs:samples`, update `porIssued` in `fixtures/personas/personas.json`, then `npm run demo:record`.
