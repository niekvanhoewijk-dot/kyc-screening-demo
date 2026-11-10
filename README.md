# KYC/KYB Screening Demo

An illustrative onboarding and compliance-screening demo for a digital assets platform. It uses Claude for document reading, case preparation and an AI interviewer, and a deterministic rules engine for every decision number.

**Status:** Phases 0-9, 10a, 10b and 11 done (demo-ready). Next: 10c-10f (MCP servers, OAuth, agent evals). OTP codes print in the `npm run dev` console.
- **Phases 0-7:** scaffold, rules engine (`src/engine`), applicant portal for individuals and companies (`/apply`, steps 2.1.1-2.1.8 plus EDD and KYB), Claude document reading, KYB classification and case memo (`src/documents`), KYB gap list (`src/kyb`), analyst console (`/analyst`), eval report (`npm run eval`), Ateaya-look design (Phase 7).
- **Phase 8:** the lifecycle and policy simulator (`/analyst/simulator`): versioned policies, hash-chained decision records, a synthetic book, scenarios S1-S5.
- **Phase 9:** ID wallet-first intake (test mode): an applicant can prove identity with an EU Digital Identity wallet credential (SD-JWT VC PID) instead of a document photo and selfie, verified with `node:crypto`, with the document route kept as a fallback and an evidence-assurance level shown to the analyst.
- **Phase 10a:** the agent tool layer (`src/agent`). Five applicant tools (`get_application_status`, `get_next_questions`, `save_answers`, `get_review_summary`, `request_secure_step`) sit in one registry with strict input and output schemas, scope checks and an audit entry for every call. Answers an assistant collects are saved as drafts: the applicant checks them on the questionnaire review page and ticks the declaration themselves. The analyst sees which channel each answer came from (form, AI assistant in the portal, or AI client over MCP).
- **Phase 10b:** the AI interviewer at `/apply/interview` (for individual applicants: "Answer with an AI assistant" on the overview and the step screens). Claude asks the questionnaire through those tools, with a disclosure banner, the existing identity and residence steps shown as inline cards, an output guard, caps on turns, tool calls and cost per case, and a fixed deflection line for anything outside the tools. No chat text is stored. The assistant cannot submit, tick the declaration or see any score, and the rules engine still decides.
- **Phase 11:** Demo Mode, a console switch that pre-fills every `/apply` screen and attaches sample documents (see below).

**Claude document reading:** put `ANTHROPIC_API_KEY=...` in `.env.local`, then `npm run docs:record` reads the labelled SAMPLE set in `fixtures/documents/` live and records the responses in `fixtures/claude-cache/`. After that, `npm run test` replays them offline and asserts the expected reason codes, `npm run eval` writes `reports/eval-<date>.md` (precision/recall per reason code, KYB classification accuracy, cost per case), and `DEMO_MODE=replay` runs the app without a key. `npm run docs:samples` regenerates the documents (macOS, uses `sips`).

**AI interviewer:** `npm run interview:record` plays the 12 scripted synthetic applicants in `fixtures/interviews/` (cooperative, vague, self-contradicting, hostile and non-English; English, Dutch, Greek and German; document and wallet routes) live against the API with the key in `.env.local`, and records the replies in `fixtures/claude-cache/`. It costs money, and it is not part of `npm run test`. No interview recordings are included yet. Until they are, the offline chat shows its greeting and answers every message with "not recorded" and a link to the form, and the scripted-replay tests are skipped. `AGENT_ENABLED=false` in `.env.local` hides the interviewer.

## Run the demo (offline)
**Fast path:** `npm run preflight` checks readiness (dependencies, `.env.local`, recordings, persona dates, port). `npm run demo` runs the preflight, resets the 6 synthetic cases and starts the app at http://localhost:3000/analyst. Restart without resetting: `npm run dev`.

Step by step:
1. `npm install && cp .env.example .env.local` (`DEMO_MODE=replay`: no API key, no network calls)
2. `npm run demo:reset` seeds 6 synthetic personas (Low, Medium, High, Auto-High, Prohibited, a company)
3. `npm run dev`, open http://localhost:3000/analyst, choose an analyst
4. Follow `docs/DEMO-SCRIPT.md` (5 minutes, plus a 2-minute simulator segment and a 1-minute ID wallet segment at `/apply`, step 4). Reset any time at `/analyst/demo`; it also undoes everything applied in the simulator.
5. Demo Mode (Cases page, or `/analyst/demo`) pre-fills every `/apply` screen and attaches sample documents for a chosen persona, so you can click through the whole journey without typing. See `docs/spec/11-demo-mode.md`.
6. The AI interviewer: "Answer with an AI assistant" on the `/apply` overview opens `/apply/interview`. Offline it replies only to recorded messages (see "AI interviewer" above).
7. `npm run verify:records` recomputes every decision-record hash chain in the local database and replays every record.

Claude's pre-review and memos replay recorded responses. Record them once with an API key in `.env.local`: `npm run demo:record` (persona cases) and `npm run docs:record` (labelled eval sets). Without recordings, MVP 1 runs fully and MVP 2 shows "not recorded".

## Start building
1. Open a terminal in this folder: `cd ~/Documents/Ateaya/KYC/claude-code`
2. Install and verify the rules oracle: `npm install && npm run setup:py && npm run verify:golden` (expect "ALL GOLDEN CASES PASS")
3. Run `claude` here. It loads `CLAUDE.md` automatically.
4. Paste the Phase 0 prompt from `docs/BUILD-PLAN.md`, then proceed phase by phase.

## What is in here
| Path | Purpose |
|---|---|
| `CLAUDE.md` | Standing instructions for Claude Code: principles, stack, guardrails |
| `docs/spec/00-11` | Scope and decisions, flow mapping, requirements, scoring, EDD, Claude's role, open questions, the lifecycle and policy simulator (08), ID wallet-first intake (09), the agent interviewer and MCP servers (10), Demo Mode (11) |
| `docs/BUILD-PLAN.md` | Phases, acceptance criteria, starter prompts |
| `config/risk-matrix.yaml` | Points, bands, tiers, threshold rules (single source of numbers) |
| `config/country-risk.yaml` | FATF black/grey lists as of 19 Jun 2026, with sources (policy P1) |
| `config/policy/` | Policy versions (`policies.yaml`: P1, P2, knobs, AMLR review limits) and the October 2026 list (P2) |
| `config/wallet.yaml` | ID wallet intake (test mode): relying party, requested attributes, verifier limits, trust list, evidence levels |
| `src/wallet/` | SD-JWT VC verifier, the demo PID issuer and the test wallet with its scenarios |
| `config/agent.yaml` | Agent settings: the interviewer's prompt version, effort, caps and fixed lines, the output-guard terms, tool scopes |
| `src/agent/` | Tool registry and applicant tools, answer drafts, the interviewer turn loop, output guard and versioned prompts |
| `fixtures/interviews/` | 12 scripted synthetic applicants for the interviewer (replay tests and `npm run interview:record`) |
| `fixtures/portfolio/book.json` | 18 synthetic, engine-only customers for the simulator |
| `tests/golden/*.json` | 18 rule cases (8 from the requirements doc, 10 derived) and the simulator scenarios S1-S5 (`scenarios.json`), all pinned from the oracle |
| `tools/verify_golden.py` | Reference oracle for the rules |

## About this demo
This is an illustrative demo, not a regulated compliance system. It follows a KYC/KYB/AML onboarding design the author produced at Ateaya in 2024. The original requirements documents are not included in this repository. The demo uses generic branding and synthetic data only; every sample document is watermarked SAMPLE, and the ID wallet runs in test mode only, with a built-in demo issuer and no real wallet or person data.
