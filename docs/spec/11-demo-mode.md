# 11 Demo Mode (Phase 11)

Status: built 10 Nov 2026 on top of Phase 9 (spec 09). Synthetic data only. Illustrative demo, not a regulated compliance system.

## 1. What it is

A switch in the analyst console called **Demo Mode**. While it is on, every "open an account" screen under `/apply` arrives filled in, and the documents attach themselves. The presenter walks the whole journey by pressing the main button on each screen, without typing, choosing a file or looking up an OTP code.

It exists for interviews and screen shares, where typing synthetic data live is slow and error-prone. It is a presentation aid. It never reaches the rules engine, the policy, the audit of a case decision or the analyst's judgement.

## 2. Where the controls are

| Place | What it does |
|---|---|
| Cases page, header | **Demo Mode** Off / On segmented control, next to the MVP mode control |
| `/analyst/demo` (Demo controls), card "Demo Mode" | Persona picker, "Turn on Demo Mode" / "Save sample applicant", "Turn off", a link that opens `/apply` in a new tab |
| Nav foot | "Demo Mode on: <persona name>" while it is on |
| `/apply` screens | A grey banner: "Demo Mode is on. Everything on this screen is filled in for you, and sample documents attach themselves. Just press the button." |

Only a signed-in analyst can change the switch. A change writes `demo_mode.changed` to the audit trail with the old and new value.

## 3. Personas

The picker offers the six seeded personas: low, medium, high, auto_high, prohibited and company. Each click-through uses the same values as the seeder (`src/demo/prefill.ts` is the shared source), so the case lands in the band the seeded case has. Tests check that for every persona.

The persona is bound to the applicant at first use. Changing the persona in the console while an application is half done does not change that application.

## 4. What is filled in

| Screen | Filled in |
|---|---|
| Create account | A fresh, unique address per run (`first.last.N@demo.test`, `first.last.company.N@demo.test` for companies), so a run never signs in as a seeded persona |
| Verify email | The code. It is captured when the mock mailer sends it and passed to the page in a short-lived cookie (`kyc_demo_code`), because only a hash is stored |
| Identity | Document type, issuing country, expiry; front of the ID and the selfie attach as samples |
| Residence | Address, phone, document type; proof of residence attaches as a sample |
| Questionnaire | Every answer, and the declaration is ticked. The presenter still presses Continue |
| Company | Company form, then the representative, then the next person to add, each with their ID and proof of residence samples |
| Company documents | The full document pack |
| EDD request | Source-of-funds document and, when required, the extra KYC sample |

Rules for samples:
- Sample files are the persona fixtures in `fixtures/personas` and `fixtures/documents/kyb`. They carry the SAMPLE watermark.
- A sample attaches only when the applicant chose no file and nothing is on file for that slot. A file the presenter chooses always wins, and an existing document is never replaced.
- Each upload slot shows a thumbnail and "Demo Mode attached a sample <what> (<file name>). Choose a file only to replace it." The thumbnails come from `/apply/demo-sample/<slot>`, which needs a signed-in applicant and returns 404 for anything else.

## 5. Boundaries

1. Demo Mode is not an input to the engine, the policy bundle, the threshold or the pre-review. The same values entered by hand give the same result.
2. The applicant banner never mentions risk, bands, screening or PEP (D7). The persona name and story appear on the analyst side only.
3. Samples are the repo's synthetic fixtures. Nothing real is read or asked for.
4. Demo Mode stores its state in the existing `settings` table (`demo.on`, `demo.persona`, `demo.applicant.<id>`). No migration.
5. A demo reset wipes the cases but keeps the Demo Mode settings, so the presenter does not have to switch it on again.
6. With Demo Mode off, every screen behaves exactly as before.

## 6. Walk-through for a presenter

1. Console: Demo controls, pick a persona, **Turn on Demo Mode**.
2. Open `/apply`. Press Continue on each screen: account, code, overview, identity, residence, questionnaire, check, submit. The company persona adds company, people and company documents.
3. Back in the console, the new case is in the queue in the persona's band.

## 7. Known limits

- The wallet route (spec 09) uses the built-in test wallet. Its made-up data is the wallet's own, so a wallet click-through can score differently from the persona (O-96). On the residence screen the wallet's address stays; Demo Mode fills only the document type and phone, so Continue still works. The document route follows the persona.
- The declaration is pre-ticked in Demo Mode (D26). The interviewer in spec 10 keeps the rule that a person ticks it.
- Demo Mode fills what the form asks. It does not run a script across tabs or record the screen.

## 8. Tests

`tests/demo/demo-mode.test.ts`: switch state, audit and no-op, unknown persona, persona binding, unique addresses, every sample slot of every persona (byte-for-byte against the fixtures), samples never replacing a document, click-throughs for each individual persona and the company ending in the seeded band, and survival across a reset.
