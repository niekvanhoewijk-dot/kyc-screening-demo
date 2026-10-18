# 02 — Individual KYC: POI, POR, questionnaire, screening

Source: Full v3 sections 1-4.

## Proof of Identity (POI)
- Accepted: passport, ID card, driving licence. Must be valid (not expired); **all four corners visible**.
- Extract: name and surname, picture, date of birth, document number, nationality or issuing country (and place of birth if applicable), issue and expiry dates. Some countries issue IDs without expiry: provide the option **"my document has no expiration date"**.
- **Selfie required** (D5): liveness + face match against the POI picture via `FaceMatchProvider` (mock).
- Rejected: bad condition, edited, unclear, watermarks of any kind. A document that appears intentionally edited is **fraud**: flag for the analyst (the doc says most firms reject immediately and end the relationship). Claude only flags; the analyst decides.

## Proof of Residence (POR) (D10)
- Collect first: apartment/flat/suite (optional), address line 1 (mandatory), address line 2, city/town/village (mandatory), county/region (mandatory), country (mandatory), postcode; mobile and landline numbers.
- Accepted (one document): utility bill (electricity, gas, water, sewage, internet, TV, home phone); bank or credit card statement (client may cover transactions and amounts, but issuer, client name, address and issue date must be visible); official government/state/municipal document stating residence (tax declaration, tax card, stay permit, certificate of residence).
- Issued within the **last 3 months**; four corners visible.
- Rejected: photos of envelopes or parcels, mobile phone bills, P.O. box addresses. A joint-account bill is acceptable only if the other person also completes KYC.
- Expiry: if the document shows an expiry date, adopt it; otherwise set 6 or 12 months after issue (configurable). **Two weeks before expiry** (configurable) notify the client to submit a new POR. On expiry the client may **not deposit or withdraw** until a new POR is approved.

## Questionnaire (individual)
Fields: a) date of birth (must match the POI) b) nationality c) preferred language d) phone with country code e) email (verified by automated email) f) TIN, or a short reason why none (e.g. income too low, country issues TINs only for companies) g) **US tax resident? Yes = cannot be accepted** h) PEP now or previously (PEP = High, D9) i) full address (country risk) j) declaration of understanding of risk disclosure and terms ("I declare that I have carefully read, accept, and fully understood ..."), k) expected deposit in next 12 months, l) source of funds, m) employment status, n) industry of occupation, o) total estimated annual income, p) estimated net worth.
Scored factors: country (i), k, l, m, n, o, p. Bands and tiers: `config/risk-matrix.yaml`.

## Screening (doc section 4)
Every client goes through World-Check-style screening (`ScreeningProvider` mock, seeded with fictional watchlist entries) plus sanctions, FATF black list (not accepted), FATF grey list and EU sanctions map (accepted but automatically High-Risk). Hits are triaged by the analyst; Claude may explain the likely match quality (name similarity, DOB, country) but never clears a hit.

## Cross-checks Claude performs (MVP 2)
DOB on POI = DOB in questionnaire; name consistent across POI, POR and account; POR address = declared address; POI not expired; POR age; selfie result present; any signs of editing. Output: pass / flag / fail per check with a reason code (see 06).
