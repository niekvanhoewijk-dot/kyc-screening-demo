# 03 — Company KYB

Source: Full v3 section 1 "Company".

KYC is done on: the **company**, the **representative** handling the account, the **Ultimate Beneficial Owner (UBO)**, **all shareholders**, and **all members of the Board of Directors (BoD)**. Each natural person goes through POI + POR + screening as in 02.

## Document pack (checklist the portal renders and the analyst sees)
| # | Item | Applies to |
|---|---|---|
| 1 | ID/passport | Representative, UBO, shareholders, BoD |
| 2 | Proof of address | Representative, UBO, shareholders, BoD |
| 3 | Certificate of Incorporation or entry in the Commercial Register | Company |
| 4 | Articles and Memorandum of Association (or equivalent) | Company |
| 5 | Evidence of beneficial ownership | Company |
| 6 | Certificate of Registered Address | Company |
| 7 | Evidence of the company's current address (POR in the company's name) | Company |
| 8 | Certified copy of Certificate of Good Standing / Incumbency | Company |
| 9 | Register of Members | Company |
| 10 | Certificate of Shareholders | Company |
| 11 | Resolution / Certificate of Directors | Company |
| 12 | Corporate questionnaire (the doc says an example document is attached separately: **not provided**, see 07) | Company |
| 13 | Proof of directors' shares, allocation and other relevant specifics | Company |
| 14 | Risk scoring, World-Check and OFAC screening | Company + every natural person above |

## Claude's role (MVP 2)
1. **Classify** each uploaded file into one of items 3-13 (or "unrecognised").
2. **Extract** company name, registration number, registered address, directors, shareholders with percentages, UBO(s).
3. **Cross-check** that persons found in the ownership documents all appear in the KYC list (a shareholder or director with no KYC = gap), and that shareholdings add up to 100%.
4. **Produce a gap list** (missing documents, missing persons, inconsistent names) for the analyst.

## Scoring
The doc defines a scoring matrix only for individuals. Company scoring factors are **not defined** (see 07). Demo default: company risk = country of incorporation tier (config) + the highest band among its natural persons; stated clearly as a demo assumption.
