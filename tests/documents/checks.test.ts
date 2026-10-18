import { describe, expect, it } from "vitest";
import { addMonths, namesMatch, runChecks, type CheckInput } from "@/documents/checks";
import type { ReasonCode } from "@/documents/reason-codes";
import { poi, por } from "./extractions";

const rules = { confidence_threshold: 0.8, por_max_age_months: 3, por_default_validity_months: 6 };
const base = (over: Partial<CheckInput> = {}): CheckInput => ({
  today: "2026-10-18",
  applicant: { firstName: "Ada", lastName: "Sample" },
  declared: { dateOfBirth: "1990-05-01", address: { addressLine1: "1 Sample Street", city: "Athens", country: "GR", postcode: "10552" }, selfie: "passed" },
  poi: { status: "ok", extraction: poi(), calls: [] },
  por: { status: "ok", extraction: por(), calls: [] },
  ...over,
});
const codes = (input: CheckInput) => runChecks(input, rules).checks.flatMap((c) => c.reason_codes);
const statusOf = (input: CheckInput, code: ReasonCode) => runChecks(input, rules).checks.find((c) => c.reason_codes.includes(code))?.status;

describe("rule checks per reason code", () => {
  it("a clean case raises no codes", () => {
    expect(codes(base())).toEqual([]);
    expect(runChecks(base(), rules).checks.every((c) => c.status === "pass")).toBe(true);
  });

  it.each<[string, Partial<CheckInput>, ReasonCode, "fail" | "flag"]>([
    ["expired POI", { poi: { status: "ok", extraction: poi({ expiry_date: "2026-10-17" }), calls: [] } }, "POI_EXPIRED", "fail"],
    ["corners not visible", { poi: { status: "ok", extraction: poi({ corners_visible: false }), calls: [] } }, "POI_CORNERS_NOT_VISIBLE", "flag"],
    ["watermark", { poi: { status: "ok", extraction: poi({ watermark_present: true }), calls: [] } }, "POI_WATERMARK", "flag"],
    ["editing suspected", { poi: { status: "ok", extraction: poi({ appears_edited: true }), calls: [] } }, "POI_EDITING_SUSPECTED", "flag"],
    ["low confidence", { poi: { status: "ok", extraction: poi({ fields: [{ field: "full_name", value: "Ada Sample", confidence: 0.5, evidence: "" }] }), calls: [] } }, "POI_UNCLEAR", "flag"],
    ["POI extraction failed", { poi: { status: "failed", error: "Extraction failed: x", calls: [] } }, "POI_UNCLEAR", "flag"],
    ["POR older than 3 months", { por: { status: "ok", extraction: por({ issue_date: "2026-07-17" }), calls: [] } }, "POR_OLDER_THAN_3_MONTHS", "fail"],
    ["P.O. box", { por: { status: "ok", extraction: por({ is_po_box: true }), calls: [] } }, "POR_PO_BOX", "fail"],
    ["mobile bill", { por: { status: "ok", extraction: por({ document_category: "mobile_bill" }), calls: [] } }, "POR_MOBILE_BILL", "fail"],
    ["envelope", { por: { status: "ok", extraction: por({ document_category: "envelope_or_parcel" }), calls: [] } }, "POR_ENVELOPE_OR_PARCEL", "fail"],
    ["joint holder", { por: { status: "ok", extraction: por({ joint_holder_name: "Bo Sample" }), calls: [] } }, "POR_JOINT_ACCOUNT_OTHER_PERSON_NEEDS_KYC", "flag"],
    ["address fields missing", { por: { status: "ok", extraction: por({ address: { line1: null, line2: null, city: "Athens", region: null, country: "GR", postcode: null } }), calls: [] } }, "POR_ADDRESS_FIELDS_MISSING", "fail"],
    ["name mismatch", { poi: { status: "ok", extraction: poi({ full_name: "Ada Simple" }), calls: [] } }, "NAME_MISMATCH", "flag"],
    ["DOB mismatch", { poi: { status: "ok", extraction: poi({ date_of_birth: "1991-05-01" }), calls: [] } }, "DOB_MISMATCH", "flag"],
    ["address mismatch", { por: { status: "ok", extraction: por({ address: { line1: "9 Other Road", line2: null, city: "Athens", region: "Attica", country: "GR", postcode: "10552" } }), calls: [] } }, "ADDRESS_MISMATCH", "flag"],
    ["selfie failed", { declared: { ...base().declared, selfie: "failed_flagged" } }, "SELFIE_MISSING_OR_FAILED", "fail"],
    ["prompt injection", { poi: { status: "ok", extraction: poi({ issues: ["PROMPT_INJECTION_SUSPECTED"] }), calls: [] } }, "PROMPT_INJECTION_SUSPECTED", "flag"],
  ])("%s -> %s", (_, over, code, status) => {
    expect(codes(base(over))).toContain(code);
    expect(statusOf(base(over), code)).toBe(status);
  });

  it("a POR that could not be read is flagged for the analyst without a misleading code", () => {
    const c = runChecks(base({ por: { status: "failed", error: "Extraction failed: x", calls: [] } }), rules).checks.find((x) => x.name === "por_extraction");
    expect(c).toMatchObject({ status: "flag", reason_codes: [] });
  });

  it("a POI with no expiry date passes the expiry check", () => {
    expect(codes(base({ poi: { status: "ok", extraction: poi({ expiry_date: null, has_no_expiry: true, fields: poi().fields.filter((f) => f.field !== "expiry_date") }), calls: [] } }))).toEqual([]);
  });

  it("POR issued exactly 3 months ago is still accepted", () => {
    expect(codes(base({ por: { status: "ok", extraction: por({ issue_date: "2026-07-18" }), calls: [] } }))).toEqual([]);
  });

  it("adopts the POR expiry date, else issue date + default validity (spec 02)", () => {
    expect(runChecks(base(), rules).porValidUntil).toBe("2027-03-20");
    expect(runChecks(base({ por: { status: "ok", extraction: por({ expiry_date: "2026-12-31" }), calls: [] } }), rules).porValidUntil).toBe("2026-12-31");
  });
});

describe("helpers", () => {
  it("matches names ignoring case, accents, order and extra middle names", () => {
    expect(namesMatch("Ada Sample", "SAMPLE, Ada Maria")).toBe(true);
    expect(namesMatch("Zoë Pérez", "ZOE PEREZ")).toBe(true);
    expect(namesMatch("Ada Sample", "Ada Simple")).toBe(false);
  });

  it("adds months and clamps to month end", () => {
    expect(addMonths("2026-10-18", -3)).toBe("2026-07-18");
    expect(addMonths("2026-05-31", -3)).toBe("2026-02-28");
  });
});
