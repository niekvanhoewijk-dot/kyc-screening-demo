# 09 Wallet-first intake (Phase 9)

Status: design for Phase 9. Test mode only. Synthetic data only. Not a regulated compliance system.

## 1. What this adds, in one paragraph

An applicant can prove who they are by sharing a credential from an EU Digital Identity (ID) wallet instead of photographing a document and taking a selfie. The service checks the credential cryptographically, records **how strong the identity evidence is** (the evidence-assurance level) on the case, and carries on exactly as before: questionnaire, screening, risk score, threshold, analyst decision, EDD. The wallet replaces document capture. It does not replace any decision.

Why it belongs in this demo: a stand-alone screening tool can read a passport. It cannot show that the evidence behind a case has a grade, that the grade is stored, audited and shown to the analyst, and that a weaker route (documents) stays available. That orchestration is what Ateaya builds.

## 2. Scope

| In | Out (and why) |
|---|---|
| Individual applicants (persona `individual`) | Company representatives and company persons (O-72): each person would need their own wallet session |
| SD-JWT VC person identification data (PID), verified with `node:crypto` | mdoc (ISO 18013-5) format, DC API / proximity flows: more formats, no new idea |
| Verifier checks: issuer trust, signature, selective-disclosure digests, validity, key binding, nonce, audience, freshness | Revocation / Token Status List (O-73); real PID providers; relying-party registration and access certificates (O-68) |
| A built-in **test ecosystem**: a demo PID issuer and a test wallet with scenarios (valid and eight failures) | Any real wallet or real person data |
| Evidence-assurance level stored on the case, shown to the analyst, used for the EDD extra-KYC rule | Letting the level change the score, the threshold or the decision (O-75) |
| Wallet attributes pre-fill and lock date of birth and nationality; the address pre-fills the residence form | Replacing proof of residence (O-71) |
| Document route kept as a fallback, always available | Removing the document route |

"Wallet" in `docs/spec/00` (out of scope: "wallet connection, flow 2.2") means the **crypto** wallet. This feature is the **ID wallet**. UI copy says "ID wallet" and never just "wallet".

## 3. Regulatory context (what is and is not claimed)

- eIDAS 2.0 (Regulation (EU) 2024/1183): Member States offer EU Digital Identity Wallets by 24 December 2026. Regulated relying parties must accept them where strong user authentication is required from 24 December 2027, and only when the user chooses to present one.
- AMLA's final draft RTS on customer due diligence (30 September 2026, not yet adopted) is reported to treat electronic identification at substantial or high assurance, including EUDI wallets, as a default route for remote onboarding, with document-based onboarding as a justified fallback and no named liveness technique. **This comes from a vendor summary and must be checked against the RTS text before it is quoted (O-74).**
- A PID proves identity. It does not screen sanctions or PEP status, assess risk, establish source of funds or decide anything. That is why the questionnaire, screening, scoring and EDD still run.
- The evidence-assurance ladder below is a **design choice of this demo**, not a regulatory classification.

## 4. Evidence-assurance ladder

Config: `config/wallet.yaml` (`evidence_levels`). Lower rank means stronger evidence.

| Level | How the identity was evidenced | Selfie | Satisfies EDD extra KYC (spec 05) |
|---|---|---|---|
| `wallet_pid` | Issuer-signed PID, presented with key binding, trusted issuer, in date | Not required | **No** by default (O-70) |
| `document_selfie` | Document photo and selfie, face match and liveness passed | Passed | Yes (existing rule, unchanged) |
| `document_selfie_flagged` | Document photo; selfie failed after the last attempt, case flagged | Failed, flagged | No (existing rule, unchanged) |

Rungs a real deployment could add above and between these (not built): NFC chip read of the document; a selfie with injection-attack detection. The ladder is data, so adding a rung is a config change plus an adapter.

The level is **derived** from stored evidence by code (`src/portal/evidence.ts`), never typed in by a person. It is recorded in the audit trail and shown to the analyst. It does not enter the engine inputs, so decision records and golden cases are unchanged (O-75).

## 5. Applicant flow

Step 2.1.4 (identity) gets a chooser:

1. **Use your ID wallet** (recommended) or **Upload a document and take a selfie**.
2. Wallet route: the service opens a *wallet session* (a single-use nonce, the audience, the requested attributes, an expiry) and shows what it asks for and why. In test mode a clearly labelled **test wallet panel** lets the presenter pick a scenario and share. A collapsed "Technical details" block shows the request (audience, nonce, the query).
3. On success the identity step is complete with `source: wallet`. The applicant sees a short confirmation of what was shared and continues.
4. On any failure the applicant sees one neutral sentence and the choice to try again or use documents. **Reason codes are never shown to the applicant** (D7); they are in the audit trail.
5. Step 2.1.5 (residence): if the PID carried an address it pre-fills the form (still editable). A proof of residence is still required (O-71).
6. Step 2.1.6 (questionnaire): date of birth is shown read-only from the wallet. Nationality is read-only if the PID holds one nationality; if it holds several, the applicant picks one of them. The server ignores any posted value that differs (O-76).
7. Switching route replaces the earlier identity evidence: choosing documents after a wallet drops the wallet evidence; choosing the wallet after documents supersedes the stored identity images so pre-review never reads stale evidence.

## 6. Verification rules

Implemented in `src/wallet/` with `node:crypto` only (no new dependency, per CLAUDE.md). Formats follow RFC 9901 (SD-JWT) and the SD-JWT VC draft (`typ: dc+sd-jwt`; the earlier `vc+sd-jwt` is accepted during the transition, as the draft recommends). Profile: ES256 (ECDSA P-256, SHA-256), SHA-256 disclosure digests, the HAIP direction.

| # | Check | Failure code |
|---|---|---|
| 1 | Token parses; size and disclosure-count limits from config | `WALLET_TOKEN_MALFORMED` |
| 2 | Issuer-signed JWT `alg` and `typ` allowed | `WALLET_TOKEN_MALFORMED` |
| 3 | `iss` and `kid` are in the trust list | `WALLET_ISSUER_NOT_TRUSTED` |
| 4 | Issuer signature valid | `WALLET_SIGNATURE_INVALID` |
| 5 | `vct` is the requested credential type | `WALLET_WRONG_CREDENTIAL_TYPE` |
| 6 | `exp` present and in the future; `iat`/`nbf` not in the future (clock skew from config) | `WALLET_CREDENTIAL_EXPIRED` |
| 7 | Every disclosure is well formed, referenced exactly once, and its digest is in the signed payload; no reserved or duplicate claim names | `WALLET_DISCLOSURE_INVALID` |
| 8 | A key binding JWT is present | `WALLET_KEY_BINDING_MISSING` |
| 9 | Key binding JWT: `typ: kb+jwt`, signed by the `cnf` key, `sd_hash` equals the hash of the presentation it ends | `WALLET_KEY_BINDING_INVALID` |
| 10 | `nonce` equals the session nonce | `WALLET_NONCE_MISMATCH` |
| 11 | `aud` equals this relying party | `WALLET_AUDIENCE_MISMATCH` |
| 12 | `iat` of the key binding JWT within the freshness window | `WALLET_PRESENTATION_STALE` |
| 13 | All required attributes are disclosed | `WALLET_ATTRIBUTE_MISSING` |
| 14 | Attribute values are valid (full ISO birth date, country codes) | `WALLET_ATTRIBUTE_INVALID` |
| 15 | Document expiry attribute, when present, is not in the past | `WALLET_DOCUMENT_EXPIRED` |
| 16 | Session exists, belongs to this case, is pending and unexpired | `WALLET_SESSION_INVALID` |

Rules that matter beyond the checklist:

- **Single use.** The session is consumed *before* verification starts. A failed attempt burns the nonce, so the retry gets a new session. A captured presentation cannot be replayed.
- **Data minimisation.** Only requested attributes are stored. Extra disclosed claims are dropped and their names audited.
- **Order of failure.** Checks run in the order above; the first failure is reported.
- **What the stored evidence holds:** issuer, credential type, validity, verification time, SHA-256 of the presentation, the requested attributes, and the list of checks that passed. Never the raw token, never the holder key.

## 7. What changes in the system

| Area | Change |
|---|---|
| Config | `config/wallet.yaml` (Zod in `src/wallet/config.ts`): relying party, request, limits, attribute names, trust, evidence levels, test wallet |
| Data | New table `wallet_sessions` (migration `0007`). `cases.identity` gains optional `evidence`; `selfie` gains `not_required` |
| Adapter | `WalletVerifier` interface in `src/wallet/verifier.ts`, wired in `PortalDeps.wallet` with the test ecosystem; listed in `src/adapters/README.md` |
| Portal | `src/portal/wallet.ts` (start session, complete identity), `src/portal/evidence.ts` (level, extra-KYC rule); `saveQuestionnaire` overrides locked attributes |
| UI | Identity chooser, wallet page, test wallet panel; residence pre-fill; questionnaire read-only fields; status page wording |
| Analyst | Identity card shows evidence source, level, issuer, validity, checks; pre-review skips the identity-document read for wallet cases and runs wallet checks |
| Audit | `wallet.session_started`, `wallet.verified`, `wallet.rejected` (with code), `step.completed` carries `source` and `assurance` |
| Unchanged | Engine, policies, decision records, screening, golden cases, EDD maths |

Pre-review for a wallet case (deterministic, no Claude call for identity): evidence verified (pass), document expiry, name on the credential against the account name (`NAME_MISMATCH` flag), date of birth against the questionnaire (`DOB_MISMATCH` flag, normally equal because the field is locked). Proof of residence is read by Claude as before.

## 8. Test mode: what is real and what is not

Real: every verification step above, the cryptography, single-use sessions, the audit trail.
Simulated: the PID issuer, the wallet, and the trust list (the demo issuer's public key is listed as trusted; a second, untrusted issuer exists to prove the check). The UI says "Test mode" wherever the wallet appears. No real person, document or wallet is involved.

To go beyond test mode a relying party needs: registration with a national authority, an access certificate (WRPAC), trust-list integration for PID providers, revocation checking, and a conformance test against the Commission's reference wallet.

## 9. Test scenarios

Each scenario is a test of the verifier and a button in the test wallet panel.

| Scenario | What the test wallet does | Expected |
|---|---|---|
| `valid` | Presents a valid PID for the account holder | Verified, level `wallet_pid` |
| `name_differs` | Valid PID, different family name | Verified; pre-review flags `NAME_MISMATCH` |
| `expired_credential` | Issuer JWT `exp` in the past | `WALLET_CREDENTIAL_EXPIRED` |
| `untrusted_issuer` | Signed by an issuer not in the trust list | `WALLET_ISSUER_NOT_TRUSTED` |
| `tampered_attribute` | Changes a disclosure after issuance | `WALLET_DISCLOSURE_INVALID` |
| `wrong_holder_key` | Key binding signed by a key other than `cnf` | `WALLET_KEY_BINDING_INVALID` |
| `no_key_binding` | Presents without a key binding JWT | `WALLET_KEY_BINDING_MISSING` |
| `withheld_birthdate` | Holder declines to disclose the birth date | `WALLET_ATTRIBUTE_MISSING` |
| `replay` | Sends the previous presentation again | `WALLET_NONCE_MISMATCH` (new session, old nonce) |

Further unit tests: wrong audience, stale key binding, wrong credential type, consumed session, expired session, unknown session, another case's session, extra claims dropped.

Integration tests: wallet path reaches submission with the same score and threshold as the document path for the same answers; locked fields cannot be overridden; fallback to documents after a wallet failure; switching route; EDD extra-KYC rule per level; company persona refused; pre-review skips the identity read.

## 10. Open questions

Recorded in `docs/spec/07-open-questions.md` as O-68 to O-76.
