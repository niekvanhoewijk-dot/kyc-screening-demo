# 01 — Flow mapping (applicant portal and analyst console)

From the DVAULT flow blueprint, section 2.1 KYC/KYB. The part of the journey marked in the blueprint as the focus is 2.1.3 to 2.1.8.
General rule from the blueprint: **error handling is required across all stages**, and **the user can leave and return** (the process does not have to be concluded in a single session) so every step is resumable.

## Steps
| Flow ID | Screen | Individual | Company | Notes |
|---|---|---|---|---|
| 2.1.1 | Create account 1/2 | First name, last name, email, submit | First name, last name (of the representative), email, submit | Persona chosen here: Individual or Company |
| 2.1.2 | Create account 2/2 | "Check your email", OTP / link | same | Email verification is required (doc 3e). Mock mailer prints the OTP in the dev console |
| 2.1.3 | Overview | Heads-up of the documents expected, to be ready before starting | same | Resume point for returning users |
| 2.1.4 | Proof of Identity | POI upload + selfie | Representative, UBO, shareholders, board: POI each | See 02 and 03 |
| 2.1.5 | Proof of Residence | Address + POR upload | POR for representative and for the company | See 02 and 03 |
| 2.1.6 | Questionnaire and risk scoring | Individual questionnaire | Corporate questionnaire | Scoring is invisible to the applicant |
| 2.1.7 | Check | "Text copy: we will confirm either way asap" | same | Case lands in the analyst queue |
| Decision | Analyst decision (outputs below) | | | |
| EDD | Enhanced due diligence | SoF proof + extra KYC | same | Returns to Confirmation when satisfied. See 05 |
| 2.1.8 | Confirmation | Approved message and threshold shown | same | |
| No-go | Rejection message | D7 text | same | Process after rejection is "to be formulated" in the blueprint; demo shows only the message and an analyst note |

## Decision node (D8)
- **Yes** -> 2.1.8 Confirmation
- **Have further questions** -> EDD -> 2.1.8
- **No** -> no-go message

## Operational orchestration lane
| Mode | Behaviour | Demo toggle |
|---|---|---|
| MVP 1 | Manual KYC/KYB/AML checks by designated persons: POI, POR, questionnaire + risk scoring, World-Check/OFAC, EDD. Rules engine computes the score; the analyst reviews raw documents themselves | Claude pre-review hidden |
| MVP 2 | Automated checks: Claude reads documents and cross-checks, mock screening runs, Claude drafts the case memo. Analyst reviews and decides | Claude pre-review shown |

The demo narrative is the step from MVP 1 to MVP 2: same rules, same audit trail, less analyst time per case.

## Analyst console screens
Queue (filter by band, status, age) -> Case view (applicant data, documents beside Claude's extraction, score breakdown per factor, screening hits, case memo, audit trail) -> Actions: approve, request EDD, reject, with mandatory reason.

## Case states
`draft` -> `submitted` -> `in_review` -> (`edd_requested` -> `edd_submitted` ->) `approved` | `rejected`. Also `expired_por` (see 02: deposits and withdrawals blocked until a new POR is approved).
