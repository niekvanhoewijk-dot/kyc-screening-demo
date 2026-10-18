import { z } from "zod";
import { POI_READER_CODES, POR_READER_CODES } from "./reason-codes";

// Output schemas for Claude (docs/spec/06), sent as structured-output JSON schemas.
// Every key is required; "unknown" values are null so the shape is fixed. Ranges
// (confidence 0-1, ISO dates) are re-validated after parsing in validateExtraction().

const isoDateOrNull = z.string().nullable().describe("ISO date YYYY-MM-DD, or null if not on the document");

const field = z.object({
  field: z.string().describe("Field name, e.g. full_name, date_of_birth, expiry_date"),
  value: z.string().nullable(),
  confidence: z.number().describe("0 to 1"),
  evidence: z.string().describe("Where on the document the value was read, e.g. 'MRZ line 2', 'top right'"),
});

export const poiExtractionSchema = z.object({
  document_type: z.enum(["passport", "id_card", "driving_licence", "unknown"]),
  full_name: z.string().nullable(),
  date_of_birth: isoDateOrNull,
  document_number: z.string().nullable(),
  nationality_or_issuing_country: z.string().nullable().describe("ISO 3166-1 alpha-2 if possible"),
  place_of_birth: z.string().nullable(),
  issue_date: isoDateOrNull,
  expiry_date: isoDateOrNull,
  has_no_expiry: z.boolean(),
  corners_visible: z.boolean(),
  appears_edited: z.boolean(),
  watermark_present: z.boolean().describe("Ignore the demo 'SAMPLE' marking"),
  fields: z.array(field),
  issues: z.array(z.enum(POI_READER_CODES)),
  issue_notes: z.string().describe("One or two sentences explaining each issue, or empty"),
  overall_confidence: z.number().describe("0 to 1"),
});

export const porExtractionSchema = z.object({
  document_category: z.enum(["utility_bill", "bank_statement", "government_document", "mobile_bill", "envelope_or_parcel", "other"]),
  issuer: z.string().nullable(),
  holder_name: z.string().nullable(),
  address: z.object({
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    city: z.string().nullable(),
    region: z.string().nullable(),
    country: z.string().nullable().describe("ISO 3166-1 alpha-2 if possible"),
    postcode: z.string().nullable(),
  }),
  issue_date: isoDateOrNull,
  expiry_date: isoDateOrNull,
  is_po_box: z.boolean(),
  corners_visible: z.boolean(),
  joint_holder_name: z.string().nullable(),
  fields: z.array(field),
  issues: z.array(z.enum(POR_READER_CODES)),
  issue_notes: z.string(),
  overall_confidence: z.number().describe("0 to 1"),
});

export type PoiExtraction = z.infer<typeof poiExtractionSchema>;
export type PorExtraction = z.infer<typeof porExtractionSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Post-parse checks the JSON schema cannot express. Returns problems; empty = valid. */
export function validateExtraction(x: PoiExtraction | PorExtraction): string[] {
  const problems: string[] = [];
  const unit = (n: number, where: string) => {
    if (!(n >= 0 && n <= 1)) problems.push(`${where}: confidence ${n} outside 0-1`);
  };
  unit(x.overall_confidence, "overall_confidence");
  x.fields.forEach((f) => unit(f.confidence, `fields.${f.field}`));
  const dates: [string, string | null][] =
    "document_type" in x
      ? [["date_of_birth", x.date_of_birth], ["issue_date", x.issue_date], ["expiry_date", x.expiry_date]]
      : [["issue_date", x.issue_date], ["expiry_date", x.expiry_date]];
  for (const [k, v] of dates) if (v !== null && (!ISO_DATE.test(v) || Number.isNaN(Date.parse(v)))) problems.push(`${k}: "${v}" is not YYYY-MM-DD`);
  return problems;
}
