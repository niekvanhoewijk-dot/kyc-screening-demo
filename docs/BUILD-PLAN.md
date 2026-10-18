# Build plan — phases, acceptance criteria and starter prompts

Work one phase at a time. Use plan mode first for each phase, run the tests at the end, commit per phase. Ask Claude Code to update `docs/spec/07-open-questions.md` whenever it hits an ambiguity.

| Phase | Outcome | Done when | Rough effort |
|---|---|---|---|
| 0 Setup | Next.js + TS + Vitest + Drizzle/SQLite scaffold, scripts from CLAUDE.md | `npm run test` and `npm run verify:golden` run | 1 session |
| 1 Rules engine | Config loader (Zod-validated), country resolver, scoring, threshold, EDD in `src/engine` | All 18 golden cases pass in Vitest and equal the oracle; no numbers in code | 1-2 sessions |
| 2 Applicant portal | Steps 2.1.1-2.1.8 for individuals with resume and error handling; mock mailer OTP; mock face match | A synthetic applicant completes the flow end to end | 2-3 sessions |
| 3 Claude document reading | `DocumentReader` for POI and POR with schemas, retries, replay cache | Reason codes fire correctly on a labelled synthetic set (expired, no corners, POR > 3 months, P.O. box, mobile bill) | 2 sessions |
| 4 Analyst console | Queue, case view, score breakdown, mock screening hits, decision and EDD actions, audit trail, MVP 1/2 toggle | A case is decided with every action logged | 2-3 sessions |
| 5 KYB + memo + evals | Company flow, KYB classifier and gap list, case memo, per-code precision/recall report | Company case shows missing persons/documents; eval report generated | 2-3 sessions |
| 6 Demo hardening | Synthetic personas, `DEMO_MODE=replay`, 5-minute script, reset button, "illustrative demo" labelling | Runs offline from a cold start | 1 session |

## Starter prompts

**Phase 0**
> Read CLAUDE.md and docs/spec/00 and 04. Enter plan mode and propose the repo scaffold (Next.js App Router, TypeScript, Drizzle + SQLite, Vitest, Zod) with the scripts listed in CLAUDE.md. Don't implement features yet.

**Phase 1**
> Implement the rules engine in src/engine strictly from docs/spec/04 and 05 and the YAML in config/. Write Vitest tests that load every case in tests/golden/*.json first and watch them fail, then implement. Validate the YAML with Zod at load time. No numeric constants outside config/. When done, confirm results match `python3 -I tools/verify_golden.py`.

**Phase 2**
> Read docs/spec/01 and 02. Build the applicant portal for individuals: steps 2.1.1 to 2.1.8, resumable at any step, error states on every screen, OTP shown in the server console. Use generic branding "Demo Digital Assets Platform" and the illustrative-demo footer. Selfie goes through a FaceMatchProvider mock.

**Phase 3**
> Read docs/spec/06. Implement DocumentReader with the Anthropic SDK using forced tool-call JSON output validated by Zod, retry once, log every call, treat document text as untrusted. Add a replay cache in fixtures/claude-cache. Generate a labelled synthetic document set (all marked SAMPLE) and tests per reason code.

**Phase 4**
> Build the analyst console from docs/spec/01: queue, case view with score breakdown restated from the engine, screening hits from a seeded mock ScreeningProvider, decision actions with mandatory reason, audit trail, and the MVP 1/MVP 2 toggle that hides or shows Claude's pre-review.

**Phase 5**
> Read docs/spec/03. Add the company flow, KYB classifier and gap list, the case memo, and an eval script reporting precision/recall per reason code and cost per case.

**Phase 6**
> Prepare the interview demo: 5 synthetic personas (low, medium, high, auto-high, prohibited), a replay mode that needs no API key, a reset button, and a one-page demo script.

## Interview talking points this build supports
- Deterministic rules plus LLM assistance with a human decision, and why (auditability, regulators).
- The "not out of the box" gap in vendor offerings: questionnaire, risk scoring, EDD orchestration.
- MVP 1 to MVP 2: automation sequenced behind a manual process that already works.
- Measured AI quality (eval report) instead of anecdotes.
- Adapter boundaries that keep a vendor choice reversible.
