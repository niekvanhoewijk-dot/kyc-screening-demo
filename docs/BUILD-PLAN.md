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
| 10a Agent registry and drafts | `src/agent` tool registry with strict output schemas, shared field description, split questionnaire schema, `intake_drafts`, answer provenance, review page pre-filled from drafts | Registry, leak, scope, gating, parity and form-snapshot tests pass; golden tests unchanged | 1 session |
| 10b Interviewer | `/apply/interview` chat on Claude native tool use, with disclosure banner, inline step cards, output guard, caps and replay | A scripted applicant completes the questionnaire in replay and reaches review; adversarial lines get the fixed deflection | 2 sessions |
| 10c MCP applicant server, local | `/mcp/applicant` over Streamable HTTP, version negotiation, demo tokens, stdio bridge, secure-step links | Contract tests pass; Claude Code and Claude Desktop (via the bridge) complete a questionnaire locally | 1 session |
| 10d OAuth and hosting | Demo authorization server, consent screen, connections page, rate limits, URL elicitation | Auth tests pass; a public or tunnelled URL connects as a Claude custom connector | 2-3 sessions |
| 10e Analyst MCP server | `/mcp/analyst` with five read-only tools and the untrusted-text envelope | Scope tests pass; no write path exists | 1 session |
| 10f Agent evals and demo | `npm run eval:interview` with at least 12 scripted applicants, demo script segment, README, preflight | Eval gates met (0 leaks, all injections resisted); `npm run demo` runs the interviewer offline | 1 session |

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

**Phase 10a**
> Read docs/spec/10, CLAUDE.md, docs/spec/06 and 09, and O-77 to O-88 in docs/spec/07. Enter plan mode. Tests first. Build src/agent/registry.ts (ToolDef, the call wrapper, toAnthropicTools and toMcpTools), the five applicant tools with strict output schemas, src/portal/fields.ts as the single question description, the questionnaire schema split into per-field rules and cross-field refinements (add a form snapshot test before touching it), the intake_drafts table and migration 0008, provenance on the stored answers, and the review-prefill mode on /apply/questionnaire. No interviewer UI and no MCP yet. The engine, policies and golden cases must not change, and no tool output may carry a score, band, reason or screening term.

**Phase 10b**
> Read docs/spec/10 sections 7 and 12. Build /apply/interview on native tool use with the registry: disclosure banner rendered by the page, inline cards for the existing identity and residence UI, src/agent/guard.ts, caps from config/agent.yaml, audit actions, and replay with kind "interview". Write fixtures/interviews with at least 12 scripted applicants first and make them pass in replay. Add a fixed deflection line for everything outside the tools.

**Phase 10c**
> Read docs/spec/10 section 8.1, 8.2 and 8.4. Add @modelcontextprotocol/sdk (approved in D22) and build POST /mcp/applicant with version negotiation for 2026-07-28 and 2025-11-25, the demo token mint script, tools/mcp/stdio-bridge.mjs in plain Node, request and response caps, an origin check, and request_secure_step with the URL-mode elicitation path and the text fallback. First check what the installed SDK supports and record it under O-82. Add setup instructions for Claude Desktop and Claude Code to the README.

**Phase 10d**
> Read docs/spec/10 section 8.3. Build the demo OAuth 2.1 authorization server: protected resource and server metadata, authorization code with PKCE S256, the resource parameter, iss on the response, exact redirect matching, an allow-list plus dynamic registration, a consent screen, hashed audience-bound tokens, refresh rotation, and /apply/connections with revoke. Auth tests first. Label it test mode everywhere. Then document hosting (a server with a persistent disk, or a tunnel) in the README.

**Phase 10e**
> Read docs/spec/10 section 5.2. Add /mcp/analyst with list_cases, get_case, get_audit_trail, explain_score and get_policy_summary. Every tool is read-only, applicant-authored text goes out inside an untrusted envelope, no document bytes or ID numbers, and a test fails if any analyst tool is not read-only or imports src/console/actions. Analysts sign in through the console flow and get their own token scope.

**Phase 10f**
> Read docs/spec/10 section 12. Build the interview eval (npm run eval:interview) with the adversarial lines listed there, in English, Dutch and Greek, and gates from config/agent.yaml. Add a two-minute agent segment to docs/DEMO-SCRIPT.md, update README and tools/preflight.mjs for the new config and fixtures, and make sure `npm run demo` works offline from a cold start. Tune the field-match gate only from a real first run and record the number you chose.

## Interview talking points this build supports
- Deterministic rules plus LLM assistance with a human decision, and why (auditability, regulators).
- The "not out of the box" gap in vendor offerings: questionnaire, risk scoring, EDD orchestration.
- MVP 1 to MVP 2: automation sequenced behind a manual process that already works.
- Measured AI quality (eval report) instead of anecdotes.
- Adapter boundaries that keep a vendor choice reversible.
- Policy as data with replayable decision records, and a dry run that shows the blast radius of a policy change before it ships.
- Why time alone does not change a risk band, and why a policy change routes people to a human instead of closing accounts.
- Evidence has a grade: a wallet presentation, a document and a selfie are different strengths of proof, the grade is derived by code, audited and shown to the analyst, and it still never decides the case.
- Agents are a new front door, not a new decision-maker: one tool registry feeds both the in-portal interviewer and the MCP servers, outputs are allow-listed by schema, and an eval counts leaks and injection attempts instead of trusting the prompt.
- Why MCP is the outer door and not the foundation: the process lives in the service layer, so any protocol that comes next can sit on the same tools.
- A person still ticks the declaration, presses submit and decides, even when the applicant brings their own AI.
