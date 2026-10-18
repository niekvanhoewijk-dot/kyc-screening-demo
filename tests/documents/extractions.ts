import type { PoiExtraction, PorExtraction } from "@/documents/schemas";

// Hand-written extractions for testing the deterministic rule layer and the reader plumbing.
// These are test inputs, not recorded Claude output; they never go into fixtures/claude-cache.

const f = (field: string, value: string | null, confidence = 0.95) => ({ field, value, confidence, evidence: "test" });

export const poi = (over: Partial<PoiExtraction> = {}): PoiExtraction => ({
  document_type: "passport",
  full_name: "Ada Sample",
  date_of_birth: "1990-05-01",
  document_number: "SAMPLE123",
  nationality_or_issuing_country: "GR",
  place_of_birth: null,
  issue_date: "2021-01-01",
  expiry_date: "2031-01-01",
  has_no_expiry: false,
  corners_visible: true,
  appears_edited: false,
  watermark_present: false,
  fields: [f("full_name", "Ada Sample"), f("date_of_birth", "1990-05-01"), f("document_number", "SAMPLE123"), f("expiry_date", "2031-01-01")],
  issues: [],
  issue_notes: "",
  overall_confidence: 0.95,
  ...over,
});

export const por = (over: Partial<PorExtraction> = {}): PorExtraction => ({
  document_category: "utility_bill",
  issuer: "Sample Power Co",
  holder_name: "Ada Sample",
  address: { line1: "1 Sample Street", line2: null, city: "Athens", region: "Attica", country: "GR", postcode: "10552" },
  issue_date: "2026-09-20",
  expiry_date: null,
  is_po_box: false,
  corners_visible: true,
  joint_holder_name: null,
  fields: [f("holder_name", "Ada Sample"), f("issue_date", "2026-09-20"), f("address.line1", "1 Sample Street")],
  issues: [],
  issue_notes: "",
  overall_confidence: 0.93,
  ...over,
});
