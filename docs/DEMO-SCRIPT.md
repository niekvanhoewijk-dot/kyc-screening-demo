# 5-minute demo script

Illustrative demo on synthetic data. Not a regulated compliance system. Say so in the first sentence.

## Before the call (2 minutes, once)
1. `npm install`, then `cp .env.example .env.local` (keeps `DEMO_MODE=replay`: no API key, no network).
2. `npm run demo:reset`: seeds 6 synthetic cases. `npm run dev`, open `localhost:3000/analyst`, pick **Analyst One** under "Signed in as" at the bottom of the black nav and press Sign in. Mode (top right of the Cases page): **MVP 1 · manual**.
3. Claude panels replay recorded responses. If **Demo controls** (in the nav) says nothing is recorded, run `npm run demo:record` once with a key in `.env.local` (live calls, a few dollars at most). Without recordings, demo MVP 2 from the tests and the eval report instead.
4. Second tab: `localhost:3000/apply`.

## The 5 minutes
| Time | Show | Say |
|---|---|---|
| 0:00 | Home page, "Illustrative demo" badge | Vendors cover ID and address checks. The questionnaire, risk score, threshold and EDD orchestration are what you still build. Rules decide, Claude assists, a person decides. |
| 0:30 | `/apply`: account, OTP (server console), overview; the black side panel shows the 8 steps | Every step resumable; error states on each screen; the applicant never sees score, PEP or screening reasons. |
| 1:15 | **Cases** (nav): Low, Medium, High, Auto-High, Prohibited, Company, with flags from rules and screening | Five personas from the requirements' worked examples. The engine scored them at submission. |
| 1:30 | **Ada Sample (Low 8)**: summary tiles, score breakdown, country source with its as-of date, threshold $19,999 with the limit tagged Binding | No numbers in code: points, bands, caps and country lists live in YAML with source and date. 18 golden cases equal a Python oracle. |
| 2:00 | Ada: Start review, then in Screening hits mark "Ada Sampel" a false positive with a reason; in Record your decision pick Approve, give a reason, Record decision | Only a person clears a hit. Every action needs a reason and lands in the audit trail. |
| 2:30 | **Petros Demopoulos (High, PEP)**: the Approve card is greyed out with "EDD must be completed" | D9: PEP means at least High. The engine sets what is possible; the analyst decides within it. EDD reproduces the doc example: $200k salary evidenced, $100k deposited, new threshold $160k. |
| 3:00 | **Sam Nemune (Prohibited 107)**: only the Reject card is available | FATF call-for-action. The applicant sees one neutral sentence (D7, no tipping off). |
| 3:20 | Back on **Cases**, switch the Mode control to **MVP 2 · Claude pre-review** | Same rules, same audit trail. MVP 1 is the manual process that already works; MVP 2 adds Claude. |
| 3:30 | **Tom Example (Medium 15)**: card "Document checks and case memo": proof of residence older than 3 months (Fail), fields with confidence and evidence | Claude extracts and reports; code enforces dates and document types; low confidence never auto-passes. Document text is untrusted input. |
| 4:00 | Same card: the case memo, marked Advisory; open "Engine result as restated" to show it is copied by code | Structured output, schema-validated, retried once; model, prompt version and input hash logged per call. |
| 4:20 | **Sample Holdings B.V.**: "Why the company is Auto-High", people and bands, "What we have and what is missing" (4 of 10), the Classification check | Company risk is a stated demo default (O-8). The gap list is code over declared data and Claude's classifications. |
| 4:40 | Audit trail at the bottom of a case (or **Audit trail** in the nav); **Evaluation report** in the nav (after `npm run eval`) | Precision and recall per reason code and cost per case, measured on a labelled synthetic set instead of anecdotes. Swapping a vendor touches an adapter, not the scoring. |

## If something goes wrong
- Anything odd on screen: **Demo controls** in the nav, type RESET (about 2 seconds, offline).
- A Claude panel says "not recorded": the run is in replay without that recording. Say so and move on to the rules engine; it is the part that decides.
- Persona proof-of-residence dates are fixed (September 2026). After about 20 December 2026 the Low persona's POR also becomes older than 3 months: regenerate with `npm run docs:samples`, update `porIssued` in `fixtures/personas/personas.json`, then `npm run demo:record`.
