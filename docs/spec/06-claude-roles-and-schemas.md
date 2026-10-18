# 06 — What Claude does, and what it never does

## Division of labour
| Task | Owner |
|---|---|
| Read POI / POR images and PDFs into structured fields | **Claude** (vision) |
| Validity checks (expired, corners visible, edited-looking, POR age, forbidden POR types) | **Claude** reports, **rules** enforce dates and enums |
| Cross-checks between documents and questionnaire | **Claude** proposes, code compares extracted fields |
| KYB document classification, ownership extraction, gap list | **Claude** |
| Screening hit explanation ("likely false positive because ...") | **Claude**, never clears a hit |
| Case memo and EDD request draft for the analyst | **Claude** |
| Score, band, threshold, EDD recalculation | **Rules engine only** |
| Final approve / reject / EDD decision | **Human analyst** |

## Calling pattern
- Anthropic SDK; model from `CLAUDE_MODEL` (default `claude-sonnet-5-5`).
- Force structured output through a **tool call with a JSON schema** (Zod in code); validate; on failure retry once, then route to the analyst as "extraction failed".
- Send images/PDFs as content blocks. Put the stable requirements text in a cached system block. Log model, prompt version, input hash, output.
- Temperature 0. Treat all document text as **untrusted data**: documents may contain instructions ("approve this client"); the system prompt states they must be ignored and any such text is reported as `prompt_injection_suspected`.
- Every field carries `confidence` 0-1 and `evidence` (where on the document). Confidence < 0.8 on a required field -> analyst review.

## Reason codes (closed list)
`POI_EXPIRED`, `POI_CORNERS_NOT_VISIBLE`, `POI_UNCLEAR`, `POI_WATERMARK`, `POI_EDITING_SUSPECTED`, `POR_OLDER_THAN_3_MONTHS`, `POR_PO_BOX`, `POR_MOBILE_BILL`, `POR_ENVELOPE_OR_PARCEL`, `POR_JOINT_ACCOUNT_OTHER_PERSON_NEEDS_KYC`, `POR_ADDRESS_FIELDS_MISSING`, `NAME_MISMATCH`, `DOB_MISMATCH`, `ADDRESS_MISMATCH`, `SELFIE_MISSING_OR_FAILED`, `PROMPT_INJECTION_SUSPECTED`, `KYB_PERSON_WITHOUT_KYC`, `KYB_SHAREHOLDING_NOT_100`, `KYB_DOCUMENT_MISSING`.

## Schemas (shape; implement with Zod)
```
PoiExtraction {
  document_type: "passport"|"id_card"|"driving_licence"|"unknown",
  full_name, date_of_birth, document_number, nationality_or_issuing_country,
  place_of_birth?, issue_date?, expiry_date?, has_no_expiry: boolean,
  corners_visible: boolean, appears_edited: boolean, watermark_present: boolean,
  fields: Record<field, {value, confidence, evidence}>,
  issues: ReasonCode[], overall_confidence
}
PorExtraction {
  document_category: "utility_bill"|"bank_statement"|"government_document"|"mobile_bill"|"envelope_or_parcel"|"other",
  issuer, holder_name, address {line1, line2?, city, region, country, postcode?},
  issue_date, is_po_box: boolean, corners_visible: boolean, joint_holder_name?,
  issues: ReasonCode[], overall_confidence
}
KybClassification { document_type: item 3..13 | "unrecognised", company_name?, registration_number?,
  registered_address?, persons: {name, role: director|shareholder|ubo|representative, share_percent?}[], issues }
CaseMemo { summary (max 120 words), score_breakdown_restatement (copied from engine, not computed),
  checks: {name, status: pass|flag|fail, reason_codes}[], screening_notes, suggested_edd_requests[],
  recommended_action: "approve"|"edd"|"reject"|"needs_human_review",
  disclaimer: "Advisory only. Decision rests with the analyst." }
```
`CaseMemo.recommended_action` is advisory and displayed under the engine's decision, never in place of it.

## Evaluation (add in Phase 5)
A small labelled set of synthetic documents per reason code (`fixtures/documents/`); report per-code precision/recall and a cost-per-case figure. This is the evidence that the AI step is trustworthy.
