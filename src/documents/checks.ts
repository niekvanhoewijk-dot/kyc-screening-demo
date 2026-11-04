import type { ReasonCode } from "./reason-codes";
import type { ReadOutcome } from "./reader";
import type { PoiExtraction, PorExtraction } from "./schemas";
import type { PidAttributes } from "@/wallet/types";

// Deterministic checks on Claude's extractions (docs/spec/02 cross-checks, spec/06 division of labour).
// Rules enforce dates and enums -> "fail". Claude's visual judgements and fuzzy matches -> "flag".
// Nothing here approves or rejects: every result goes to the analyst.

export type CheckStatus = "pass" | "flag" | "fail";
export type Check = { name: string; status: CheckStatus; reason_codes: ReasonCode[]; detail: string; source: "rules" | "claude" };

/** What an ID wallet presentation established (docs/spec/09). Checked by code; Claude reads no identity document. */
export type WalletCheckInput = { attributes: PidAttributes; credentialExpiresAt: string; issuerName: string; verifiedChecks: string[] };

export type CheckInput = {
  today: string; // YYYY-MM-DD
  applicant: { firstName: string; lastName: string };
  declared: {
    dateOfBirth: string;
    address: { addressLine1: string; city: string; country: string; postcode?: string };
    selfie: "passed" | "retry" | "failed_flagged" | "not_required" | undefined;
  };
  por: ReadOutcome<PorExtraction>;
  /** Exactly one of `poi` (document identity) and `wallet` (ID wallet identity) is given. */
  poi?: ReadOutcome<PoiExtraction>;
  wallet?: WalletCheckInput;
};

export type CheckRules = { confidence_threshold: number; por_max_age_months: number; por_default_validity_months: number };

export function addMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, "yyyy-mm-dd".length);
}

const normalise = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const tokens = (s: string) => new Set(normalise(s).split(" ").filter(Boolean));

/** Every token of the account name appears on the document (middle names on the document are fine). */
export function namesMatch(accountName: string, documentName: string | null): boolean {
  if (!documentName) return false;
  const doc = tokens(documentName);
  return [...tokens(accountName)].every((t) => doc.has(t));
}

const lowConfidence = (x: PoiExtraction | PorExtraction, fields: string[], threshold: number) =>
  x.fields.filter((f) => fields.includes(f.field) && f.confidence < threshold).map((f) => f.field);

const check = (name: string, status: CheckStatus, reason_codes: ReasonCode[], detail: string, source: Check["source"] = "rules"): Check => ({
  name,
  status,
  reason_codes,
  detail,
  source,
});

export function runChecks(input: CheckInput, rules: CheckRules): { checks: Check[]; porValidUntil: string | null } {
  const checks: Check[] = [];
  const accountName = `${input.applicant.firstName} ${input.applicant.lastName}`;

  if (input.wallet) {
    // --- Identity from an ID wallet: deterministic checks on attested attributes (spec 09). No selfie, no document read.
    const w = input.wallet;
    checks.push(check("wallet_evidence", "pass", [], `Identity shared from an ID wallet, issued by ${w.issuerName}. Passed: ${w.verifiedChecks.join(", ")}.`));
    const expiry = w.attributes.documentExpiry ?? w.credentialExpiresAt.slice(0, "yyyy-mm-dd".length);
    checks.push(expiry < input.today ? check("poi_expiry", "fail", ["POI_EXPIRED"], `Expired on ${expiry}.`) : check("poi_expiry", "pass", [], `Valid until ${expiry}.`));
    const walletName = `${w.attributes.givenName} ${w.attributes.familyName}`;
    checks.push(
      namesMatch(accountName, walletName)
        ? check("poi_name", "pass", [], "Name in the credential matches the account.")
        : check("poi_name", "flag", ["NAME_MISMATCH"], `Credential name "${walletName}" vs account "${accountName}".`),
    );
    checks.push(
      w.attributes.birthDate === input.declared.dateOfBirth
        ? check("dob", "pass", [], "Date of birth matches the questionnaire.")
        : check("dob", "flag", ["DOB_MISMATCH"], `Credential ${w.attributes.birthDate} vs questionnaire ${input.declared.dateOfBirth}.`),
    );
  } else {
    const poiRead = input.poi;
    if (!poiRead) throw new Error("runChecks needs either a document reading or ID wallet evidence for the identity");
    // Selfie (D5): from the face-match provider, not Claude.
    checks.push(
      input.declared.selfie === "passed"
        ? check("selfie", "pass", [], "Liveness and face match passed.")
        : check("selfie", "fail", ["SELFIE_MISSING_OR_FAILED"], "Selfie missing or not verified by the face-match provider."),
    );

    // --- Proof of identity
    if (poiRead.status === "failed") {
      checks.push(check("poi_extraction", "flag", ["POI_UNCLEAR"], `${poiRead.error} Analyst to review the document manually.`));
    } else {
      const x = poiRead.extraction;
      if (x.has_no_expiry) checks.push(check("poi_expiry", "pass", [], "Document states it has no expiry date."));
      else if (!x.expiry_date) checks.push(check("poi_expiry", "flag", ["POI_UNCLEAR"], "Expiry date could not be read."));
      else if (x.expiry_date < input.today) checks.push(check("poi_expiry", "fail", ["POI_EXPIRED"], `Expired on ${x.expiry_date}.`));
      else checks.push(check("poi_expiry", "pass", [], `Valid until ${x.expiry_date}.`));

      const seen: ReasonCode[] = [];
      if (!x.corners_visible || x.issues.includes("POI_CORNERS_NOT_VISIBLE")) seen.push("POI_CORNERS_NOT_VISIBLE");
      if (x.watermark_present || x.issues.includes("POI_WATERMARK")) seen.push("POI_WATERMARK");
      if (x.appears_edited || x.issues.includes("POI_EDITING_SUSPECTED")) seen.push("POI_EDITING_SUSPECTED");
      if (x.issues.includes("POI_UNCLEAR")) seen.push("POI_UNCLEAR");
      checks.push(seen.length ? check("poi_quality", "flag", seen, x.issue_notes || "Reported by the document reader.", "claude") : check("poi_quality", "pass", [], "No quality issues reported.", "claude"));

      const required = ["full_name", "date_of_birth", "document_number", ...(x.has_no_expiry ? [] : ["expiry_date"])];
      const low = lowConfidence(x, required, rules.confidence_threshold);
      const missing = required.filter((r) => !x.fields.some((f) => f.field === r));
      if (low.length || missing.length || x.overall_confidence < rules.confidence_threshold)
        checks.push(check("poi_confidence", "flag", ["POI_UNCLEAR"], `Low confidence or missing: ${[...low, ...missing].join(", ") || "overall"}. Analyst review.`));

      checks.push(
        namesMatch(accountName, x.full_name)
          ? check("poi_name", "pass", [], "Name on document matches the account.")
          : check("poi_name", "flag", ["NAME_MISMATCH"], `Document name "${x.full_name ?? "unreadable"}" vs account "${accountName}".`),
      );
      checks.push(
        x.date_of_birth === input.declared.dateOfBirth
          ? check("dob", "pass", [], "Date of birth matches the questionnaire.")
          : check("dob", "flag", ["DOB_MISMATCH"], `Document ${x.date_of_birth ?? "unreadable"} vs questionnaire ${input.declared.dateOfBirth}.`),
      );
    }

  }

  // --- Proof of residence
  let porValidUntil: string | null = null;
  if (input.por.status === "failed") {
    // No reason code fits "could not read" for POR; the flag itself routes it to the analyst (spec 06).
    checks.push(check("por_extraction", "flag", [], `${input.por.error} Analyst to review the document manually.`));
  } else {
    const x = input.por.extraction;
    const oldest = addMonths(input.today, -rules.por_max_age_months);
    if (!x.issue_date) checks.push(check("por_age", "flag", [], "Issue date could not be read. Analyst to confirm the document is recent."));
    else if (x.issue_date < oldest) checks.push(check("por_age", "fail", ["POR_OLDER_THAN_3_MONTHS"], `Issued ${x.issue_date}, older than ${rules.por_max_age_months} months.`));
    else checks.push(check("por_age", "pass", [], `Issued ${x.issue_date}.`));
    // spec 02: adopt the document's expiry, else issue date + configured validity.
    porValidUntil = x.expiry_date ?? (x.issue_date ? addMonths(x.issue_date, rules.por_default_validity_months) : null);

    const typeCodes: ReasonCode[] = [];
    if (x.document_category === "mobile_bill") typeCodes.push("POR_MOBILE_BILL");
    if (x.document_category === "envelope_or_parcel") typeCodes.push("POR_ENVELOPE_OR_PARCEL");
    if (x.is_po_box) typeCodes.push("POR_PO_BOX");
    checks.push(typeCodes.length ? check("por_type", "fail", typeCodes, `Not acceptable as proof of residence (${x.document_category}${x.is_po_box ? ", P.O. box" : ""}).`) : check("por_type", "pass", [], `Accepted type: ${x.document_category}.`));

    if (x.document_category === "other") checks.push(check("por_category", "flag", [], "Document type not recognised as an accepted proof of residence."));
    if (x.joint_holder_name) checks.push(check("por_joint", "flag", ["POR_JOINT_ACCOUNT_OTHER_PERSON_NEEDS_KYC"], `Joint holder "${x.joint_holder_name}" must also complete KYC.`));
    if (!x.corners_visible) checks.push(check("por_quality", "flag", [], "Not all four corners visible.", "claude"));

    const missingAddress = (["line1", "city", "country"] as const).filter((k) => !x.address[k]);
    if (missingAddress.length || x.issues.includes("POR_ADDRESS_FIELDS_MISSING"))
      checks.push(check("por_address_fields", "fail", ["POR_ADDRESS_FIELDS_MISSING"], `Missing on document: ${missingAddress.join(", ") || "reported by reader"}.`));

    const d = input.declared.address;
    const sameLine = !!x.address.line1 && normalise(x.address.line1) === normalise(d.addressLine1);
    const sameCountry = !x.address.country || x.address.country.toUpperCase() === d.country;
    const samePostcode = !x.address.postcode || !d.postcode || normalise(x.address.postcode) === normalise(d.postcode);
    checks.push(
      sameLine && sameCountry && samePostcode
        ? check("address", "pass", [], "Address matches the declared address.")
        : check("address", "flag", ["ADDRESS_MISMATCH"], `Document "${[x.address.line1, x.address.postcode, x.address.country].filter(Boolean).join(", ")}" vs declared "${[d.addressLine1, d.postcode, d.country].filter(Boolean).join(", ")}".`),
    );
    checks.push(
      namesMatch(accountName, x.holder_name)
        ? check("por_name", "pass", [], "Holder name matches the account.")
        : check("por_name", "flag", ["NAME_MISMATCH"], `Holder "${x.holder_name ?? "unreadable"}" vs account "${accountName}".`),
    );
  }

  // Prompt injection on either document: always surfaced.
  const injected = [input.poi, input.por].some((r) => r?.status === "ok" && (r.extraction.issues as string[]).includes("PROMPT_INJECTION_SUSPECTED"));
  if (injected) checks.push(check("prompt_injection", "flag", ["PROMPT_INJECTION_SUSPECTED"], "A document contains text addressed to the reviewer or an AI. It was ignored.", "claude"));

  return { checks, porValidUntil };
}
