# KYC/KYB Screening Demo (private)

An illustrative onboarding and compliance-screening demo built from the Ateaya KYC-KYB-AML requirements (Full v3) and the DVAULT onboarding flow, using Claude for document reading and case preparation and a deterministic rules engine for every decision number.

**Status:** Phases 0-5 done: scaffold, rules engine (`src/engine`), applicant portal for individuals and companies (`/apply`, steps 2.1.1-2.1.8 plus EDD and KYB), Claude document reading, KYB classification and case memo (`src/documents`), KYB gap list (`src/kyb`), analyst console (`/analyst`), eval report (`npm run eval`). OTP codes print in the `npm run dev` console.

**Claude document reading:** put `ANTHROPIC_API_KEY=...` in `.env.local`, then `npm run docs:record` reads the labelled SAMPLE set in `fixtures/documents/` live and records the responses in `fixtures/claude-cache/`. After that, `npm run test` replays them offline and asserts the expected reason codes, `npm run eval` writes `reports/eval-<date>.md` (precision/recall per reason code, KYB classification accuracy, cost per case), and `DEMO_MODE=replay` runs the app without a key. `npm run docs:samples` regenerates the documents (macOS, uses `sips`).

## Start building
1. Open a terminal in this folder: `cd ~/Documents/Ateaya/KYC/claude-code`
2. Install and verify the rules oracle: `npm install && npm run setup:py && npm run verify:golden` (expect "ALL GOLDEN CASES PASS")
3. Run `claude` here. It loads `CLAUDE.md` automatically.
4. Paste the Phase 0 prompt from `docs/BUILD-PLAN.md`, then proceed phase by phase.

## What is in here
| Path | Purpose |
|---|---|
| `CLAUDE.md` | Standing instructions for Claude Code: principles, stack, guardrails |
| `docs/spec/00-07` | Scope and decisions, flow mapping, requirements, scoring, EDD, Claude's role, open questions |
| `docs/BUILD-PLAN.md` | Phases, acceptance criteria, starter prompts |
| `config/risk-matrix.yaml` | Points, bands, tiers, threshold rules (single source of numbers) |
| `config/country-risk.yaml` | FATF black/grey lists as of 19 Jun 2026, with sources |
| `tests/golden/*.json` | 18 cases: 8 from the requirements doc, 10 derived |
| `tools/verify_golden.py` | Reference oracle for the rules |

## Before sharing this with anyone
The logic is derived from documents confidential to Ateaya / Omikron Financial Holdings Europe LTD. Keep this folder private until you have cleared what may be reused; the demo uses generic branding and synthetic data only. See `docs/spec/07-open-questions.md` O-13.
