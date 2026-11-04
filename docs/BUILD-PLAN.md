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
| 7 Design port | Ateaya-look screens in the app (done, commit "Phase 7") | Typecheck, build and tests pass | 1 session |
| 8a Policy + decision records | Versioned policy bundle, country resolver reads policy settings, decision record on every outcome, hash chain, replay | Golden tests unchanged and green; replay and chain properties pass; every state change has a record | 1-2 sessions |
| 8b Lifecycle engine | Pure `evaluateLifecycle`, `applyEvent`, `diffUnderPolicy`; synthetic book; scenarios S1-S5 derived in the Python oracle first | `tests/golden/scenarios.json` pinned from the oracle and passing in Vitest | 1-2 sessions |
| 8c Simulator service | Simulated clock (separate from the wall clock), event injection, dry run and apply, analyst-review routing | Dry run writes only a summary record; apply is undone by reset; auth and intake unaffected by the clock | 1 session |
| 8d Simulator UI | `/analyst/simulator` in the Phase 7 look, nav item, decision record drawer with verify and replay | Walk S1-S5 in the UI; keyboard and 390px width pass | 1-2 sessions |
| 8e Demo hardening | Scenario presets, demo script update, README, preflight check for the new config | `npm run demo` runs S1 and S2 offline from a cold start | 1 session |
| 9 Wallet-first intake | ID wallet (SD-JWT VC PID, test mode) as an identity route with an evidence-assurance level; documents stay as fallback | Verifier rejects every scenario in spec 09 section 9; wallet and document paths reach the same score for the same answers; golden tests unchanged | 2 sessions |

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

**Phase 8a**
> Read docs/spec/08 sections 2 to 4, spec 04 and CLAUDE.md. Enter plan mode. Implement versioned policy and decision records: load config/policy/policies.yaml (wire config/policy/country-risk.2026-10.yaml as P2 and keep config/country-risk.yaml as P1), add the optional `action` field to fatf_call_for_action, make resolveCountry read call_for_action_treatment and recently_delisted_treatment, add src/engine/decision-record.ts with the schema, hash chain and reason codes, a decision_records table and migration, and write a record from scoreCase, recordDecision and the EDD recalculation. All existing golden tests must stay green with P1 as the default policy. Add tests for replay, hash chain, coverage and policy pinning. No numbers outside config/.

**Phase 8b**
> Read docs/spec/08 sections 5.2, 5.3 and 6. First extend tools/verify_golden.py with a scenarios mode and derive the expected results for S1 to S5 from the oracle, then pin them in tests/golden/scenarios.json. Then write fixtures/portfolio/book.json (about 18 synthetic customers, labelled Synthetic, covering the countries and dates listed in 5.2) and implement src/engine/lifecycle.ts as pure functions with no I/O. Tests first.

**Phase 8c**
> Read docs/spec/08 sections 5.1, 5.4 and 5.5. Build the simulator service: a simulated clock stored as setting sim.now that only the lifecycle evaluator and simulator read (OTP, sessions and intake checks must keep the wall clock, with a test that proves it), event injection, dry run (summary record only) and apply (writes engine.rescore records), and analyst-review routing instead of automatic termination. Every action is audited.

**Phase 8d**
> Read docs/spec/08 section 5.6 and the Phase 7 files in docs/design/ for the visual language. Build /analyst/simulator with the clock controls, policy controls and knobs, event injector, results tiles, before/after table, obligations list and the decision record drawer with Verify chain and Replay. Add the nav item. Check it at 1280px and 390px, keyboard only, and with the screen reader labels.

**Phase 8e**
> Add scenario presets for S1 to S5, update docs/DEMO-SCRIPT.md with a two-minute simulator segment (start with S1, then S2, then S3), update README and tools/preflight.mjs to check the policy files and the book, and make sure `npm run demo` works offline from a cold start.

**Phase 9**
> Read docs/spec/09, CLAUDE.md and docs/spec/07 (O-68 to O-76). Tests first. Build config/wallet.yaml with its Zod loader, the SD-JWT VC verifier and test ecosystem in src/wallet using node:crypto only (no new dependency), the wallet_sessions table and migration, src/portal/wallet.ts and src/portal/evidence.ts, the identity chooser, wallet page and test wallet panel, the questionnaire and residence pre-fill, the analyst evidence rows, and the wallet branch of pre-review. Every scenario in spec 09 section 9 needs a test. The engine, policies and golden cases must not change. Reason codes never reach the applicant.

## Interview talking points this build supports
- Deterministic rules plus LLM assistance with a human decision, and why (auditability, regulators).
- The "not out of the box" gap in vendor offerings: questionnaire, risk scoring, EDD orchestration.
- MVP 1 to MVP 2: automation sequenced behind a manual process that already works.
- Measured AI quality (eval report) instead of anecdotes.
- Adapter boundaries that keep a vendor choice reversible.
- Policy as data with replayable decision records, and a dry run that shows the blast radius of a policy change before it ships.
- Why time alone does not change a risk band, and why a policy change routes people to a human instead of closing accounts.
- Evidence has a grade: a wallet presentation, a document and a selfie are different strengths of proof, the grade is derived by code, audited and shown to the analyst, and it still never decides the case.
