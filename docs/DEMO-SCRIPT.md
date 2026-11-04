# 5-minute demo script

Illustrative demo on synthetic data. Not a regulated compliance system. Say so in the first sentence.

## Before the call (2 minutes, once)
Fast path: `npm run demo` (runs `npm run preflight`, resets the 6 cases, starts the app). If the preflight warns about missing recordings, run `npm run demo:record` first (needs a key, see step 3). Details below.

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

## Simulator segment (2 minutes, after 4:40 or when asked "what about existing customers?")
Open **Simulator** in the nav. The **Scenarios** buttons set everything up; each moves only the simulated clock (audited) and shows what to look for. Order: S1, then S2, then S3.

| Time | Show | Say |
|---|---|---|
| 0:00 | **S1 FATF October 2026 plenary**: "Changes 4 of 24", BG, CI, CD, MC from Auto-High to Low or Medium, EDD Yes → No | Policy is data: P1 is the June list, P2 the October list, each with a content hash. Here is the blast radius before anything ships. |
| 0:25 | Recently delisted: **Hold at Auto-High**, Compare: 0 changes | Delisting is a policy decision, not an automatic discount. |
| 0:40 | **S2 Myanmar knob**: MM customers Prohibited → Auto-High, $40,000 cap; KP and IR unchanged. **Dry run** | A dry run writes one summary record and nothing else. |
| 1:00 | Reason, **Apply to demo data**; then Myanmar rule back to Prohibit, Compare: "Analyst review" | A policy change never closes a relationship (D13); only a person does. |
| 1:20 | **Records** on BK-07: **Verify chain**, **Replay** on the re-score | Every outcome is a hash-chained record that replays to the same result under the policy it is pinned to. |
| 1:40 | **S3 AMLR switch-on**: reviews due "In force"; set the date to 9 Jul 2027: "Preview" | Time creates obligations, it does not change bands. AMLR Art. 26 limits are outer limits, labelled preview before 10 Jul 2027. |

S4 (proof of residence) and S5 (threshold reached) are there for questions. Afterwards: **Demo controls**, RESET, which also undoes everything applied in the simulator.

## ID wallet segment (1 minute, when asked "what about eIDAS 2.0 / digital identity wallets?")
Open `localhost:3000/apply`, create an account, and stop at step 4, **Proof of identity**. Test mode: a built-in test wallet with made-up data stands in for a real one (docs/spec/09).

| Time | Show | Say |
|---|---|---|
| 0:00 | Step 4 offers **Use my ID wallet** and **Upload a document**. Open the wallet route: "What we ask for" and the test wallet panel | The wallet shares only the attributes we ask for, and the person approves them. No document photo, no selfie. The document route stays as a fallback. |
| 0:15 | Choose **An attribute was changed after issuance**, Share. Then **Earlier presentation sent again**, Share | The applicant sees one neutral message either way (D7). The credential signature and the single-use nonce are checked in code, not by Claude. |
| 0:30 | Choose **Share a valid ID**, Share: "Verified with your ID wallet". Continue: the residence form is pre-filled; date of birth and nationality are read-only in the questionnaire | The wallet replaces document capture only. Proof of residence, questionnaire, screening, score and threshold run exactly as before. |
| 0:45 | As the analyst, open that case: **Evidence level** row, then the audit trail (`wallet.verified`, the checks that passed, claims we ignored) | Every case now carries a grade for how its identity was evidenced. The level never feeds the score (O-75); it only decides whether the EDD extra-KYC rule is met. A wallet alone does not meet it (O-70). |

Pick **Valid ID, different family name** instead of the valid one to show the analyst-side name-mismatch flag.

## If something goes wrong
- Anything odd on screen: **Demo controls** in the nav, type RESET (about 2 seconds, offline).
- A Claude panel says "not recorded": the run is in replay without that recording. Say so and move on to the rules engine; it is the part that decides.
- Headings in a plain system font: the app first started offline and could not fetch the Alexandria font. Cosmetic only; start it once online and it is used from then on.
- Simulator numbers look different from the table above: something was applied or injected earlier. Reset (Demo controls), then use the Scenarios buttons. Presets move the simulated clock to the book's demo date (4 Nov 2026), so the simulator story does not depend on today's date.
- Persona proof-of-residence dates are fixed (September 2026). After about 20 December 2026 the Low persona's POR also becomes older than 3 months: regenerate with `npm run docs:samples`, update `porIssued` in `fixtures/personas/personas.json`, then `npm run demo:record`.
