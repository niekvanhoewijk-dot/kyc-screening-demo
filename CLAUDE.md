# CLAUDE.md — KYC/KYB Screening Demo

A **private, local demo** of an onboarding + compliance screening tool, built to show product and AI-orchestration thinking in interviews. It reimplements a design that Niek (co-founder/CPO) produced at Ateaya in 2024. It is **not** a compliant production system and must always be labelled as an illustrative demo.

## Read first (in this order)
1. `docs/spec/00-scope-and-decisions.md`: what is in scope, confirmed decisions (D1-D10)
2. `docs/spec/04-risk-scoring-and-thresholds.md` and `config/*.yaml`: the numbers
3. `docs/spec/01-flow-mapping.md`: screens and states
4. `docs/spec/06-claude-roles-and-schemas.md`: what the LLM may and may not do
5. `docs/BUILD-PLAN.md`: phases and acceptance criteria. Work phase by phase.

## Architecture principles (non-negotiable)
- **The rules engine decides; Claude assists.** Risk score, band, threshold, EDD recalculation, and the final approve / reject / EDD routing are deterministic code reading `config/*.yaml`. Claude never produces a score or a decision. It extracts, classifies, cross-checks, explains and drafts. A human analyst takes the final decision (MVP 1 = Claude off, MVP 2 = Claude pre-review on).
- **No numbers in application code.** Points, bands, caps, percentages, country lists live only in `config/`. Every country entry carries `source`, `as_of`, `list_version`. The UI shows "FATF, as of <date>", never "current".
- **Vendor-style adapters with mock implementations:** `CountryRiskProvider`, `ScreeningProvider` (World-Check/OFAC-style), `FaceMatchProvider` (selfie + liveness, external supplier, not integrated), `IDVProvider`. Claude is one implementation of document reading behind `DocumentReader`. Swapping a real vendor must not touch scoring.
- **Audit trail on everything:** every state change, Claude call (model, prompt version, input hash, output) and analyst action is logged with timestamp and actor.
- **Structured outputs only** for Claude calls: JSON validated against schemas in `docs/spec/06`; reject and retry on invalid; low confidence routes to the analyst, never auto-passes.

## Stack
Next.js (App Router) + TypeScript, SQLite via Drizzle (local, private), Zod for schemas, Vitest for tests, Anthropic TypeScript SDK. Model from env `CLAUDE_MODEL` (default `claude-sonnet-5-5`). Key in `.env.local` (never committed). A `DEMO_MODE=replay` setting serves cached Claude responses from `fixtures/claude-cache/` so the demo runs offline and deterministically.

## Commands (create these in Phase 0)
- `npm run test` — Vitest, including `tests/golden/*.json`
- `npm run verify:golden` — `.venv/bin/python3 -I tools/verify_golden.py` (run `npm run setup:py` once to create the venv with PyYAML) (reference oracle; TS results must equal it)
- `npm run dev` — local app

## Testing rule
`tests/golden/*.json` contains the worked examples from the requirements doc (8) plus derived cases. They are the contract. Never edit an expected value to make a test pass. If a test looks wrong, stop and raise it in `docs/spec/07-open-questions.md`.

## Guardrails
- **Synthetic data only.** Never use or ask for real passports, addresses or customer data. Sample documents are generated fixtures with the watermark "SAMPLE".
- **Confidentiality.** The source documents (requirements PDFs, vendor deck) are confidential to Ateaya / Omikron Financial Holdings Europe LTD. Do not copy them into this repo, quote their pricing, or use their names, the Polis-X/DVAULT branding, or vendor names (Persona, LSEG) in UI copy. Generic branding: "Demo Digital Assets Platform". This folder is private until reuse is cleared.
- **No tipping off.** Applicant-facing messages never reveal sanctions, PEP, watchlist or risk-score reasons (see D7).
- **Be honest in the UI:** footer "Illustrative demo. Not a regulated compliance system."
- Do not invent compliance rules. If a rule is missing or ambiguous, add it to `docs/spec/07-open-questions.md` and use the stated default.
- Ask before adding dependencies beyond the stack above.
