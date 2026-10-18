import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { REASON_CODES } from "./reason-codes";

// fixtures/documents/labels.json: the labelled synthetic set (spec 06 / Phase 3 acceptance).
const labelsSchema = z.object({
  description: z.string(),
  context: z.object({
    as_of: z.iso.date(),
    applicant: z.object({ firstName: z.string(), lastName: z.string() }),
    declared: z.object({
      dateOfBirth: z.iso.date(),
      address: z.object({ addressLine1: z.string(), city: z.string(), country: z.string(), postcode: z.string().optional() }),
      selfie: z.enum(["passed", "retry", "failed_flagged"]),
    }),
  }),
  documents: z.array(
    z.object({ id: z.string(), file: z.string(), kind: z.enum(["poi", "por"]), expected_codes: z.array(z.enum(REASON_CODES)), note: z.string() }),
  ),
});

export type LabelledSet = z.infer<typeof labelsSchema>;
export const FIXTURE_DIR = path.resolve(process.cwd(), "fixtures/documents");

export function loadLabelledSet(): LabelledSet {
  return labelsSchema.parse(JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "labels.json"), "utf8")));
}

export const MIME_BY_EXT: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf" };
