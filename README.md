# KYC/KYB Screening Demo

An illustrative onboarding and compliance-screening demo built from the Ateaya KYC-KYB-AML requirements (Full v3) and the DVAULT onboarding flow, using Claude for document reading and case preparation and a deterministic rules engine for every decision number.

**Status:** Phases 0-9 done (demo-ready): scaffold, rules engine (`src/engine`), applicant portal for individuals and companies (`/apply`, steps 2.1.1-2.1.8 plus EDD and KYB), Claude document reading, KYB classification and case memo (`src/documents`), KYB gap list (`src/kyb`), analyst console (`/analyst`), eval report (`npm run eval`), Ateaya-look design (Phase 7), and the lifecycle and policy simulator (`/analyst/simulator`, Phase 8): versioned policies, hash-chained decision records, a synthetic book, scenarios S1-S5; and ID wallet-first intake (Phase 9, test mode): an applicant can prove identity with an EU Digital Identity wallet credential (SD-JWT VC PID) instead of a document photo and selfie, verified with `node:crypto`, with the document route kept as a fallback and an evidence-assurance level shown to the analyst. OTP codes print in the `npm run dev` console.

**Claude document reading:** put `ANTHROPIC_API_KEY=...` in `.env.local`, then `npm run docs:record` reads the labelled SAMPLE set in `fixtures/documents/` live and records the responses in `fixtures/claude-cache/`. After that, `npm run test` replays them offline and asserts the expected reason codes, `npm run eval` writes `reports/eval-<date>.md` (precision/recall per reason code, KYB classification accuracy, cost per case), and `DEMO_MODE=replay` runs the app without a key. `npm run docs:samples` regenerates the documents (macOS, uses `sips`).

## Run the demo (offline)
**Fast path:** `npm run preflight` checks readiness (dependencies, `.env.local`, recordings, persona dates, port). `npm run demo` runs the preflight, resets the 6 synthetic cases and starts the app at http://localhost:3000/analyst. Restart without resetting: `npm run dev`.

Step by step:
1. `npm install && cp .env.example .env.local` (`DEMO_MODE=replay`: no API key, no network calls)
2. `npm run demo:reset` seeds 6 synthetic personas (Low, Medium, High, Auto-High, Prohibited, a company)
3. `npm run dev`, open http://localhost:3000/analyst, choose an analyst
4. Follow `docs/DEMO-SCRIPT.md` (5 minutes, plus a 2-minute simulator segment and a 1-minute ID wallet segment at `/apply`, step 4). Reset any time at `/analyst/demo`; it also undoes everything applied in the simulator.
5. Demo Mode (Cases page, or `/analyst/demo`) pre-fills every `/apply` screen and attaches sample documents for a chosen persona, so you can click through the whole journey without typing. See `docs/spec/11-demo-mode.md`.
6. `npm run verify:records` recomputes every decision-record hash chain in the local database and replays every record.

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
| `docs/spec/00-09` | Scope and decisions, flow mapping, requirements, scoring, EDD, Claude's role, open questions, the lifecycle and policy simulator (08), ID wallet-first intake (09) |
| `docs/BUILD-PLAN.md` | Phases, acceptance criteria, starter prompts |
| `config/risk-matrix.yaml` | Points, bands, tiers, threshold rules (single source of numbers) |
| `config/country-risk.yaml` | FATF black/grey lists as of 19 Jun 2026, with sources (policy P1) |
| `config/policy/` | Policy versions (`policies.yaml`: P1, P2, knobs, AMLR review limits) and the October 2026 list (P2) |
| `config/wallet.yaml` | ID wallet intake (test mode): relying party, requested attributes, verifier limits, trust list, evidence levels |
| `src/wallet/` | SD-JWT VC verifier, the demo PID issuer and the test wallet with its scenarios |
| `fixtures/portfolio/book.json` | 18 synthetic, engine-only customers for the simulator |
| `tests/golden/*.json` | 18 rule cases (8 from the requirements doc, 10 derived) and the simulator scenarios S1-S5 (`scenarios.json`), all pinned from the oracle |
| `tools/verify_golden.py` | Reference oracle for the rules |

## About this demo
This is an illustrative demo, not a regulated compliance system. It follows a KYC/KYB/AML onboarding design the author produced at Ateaya in 2024. The original requirements documents are not included in this repository. The demo uses generic branding and synthetic data only; every sample document is watermarked SAMPLE, and the ID wallet runs in test mode only, with a built-in demo issuer and no real wallet or person data.
