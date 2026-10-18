import { z } from "zod";
import { uploadableItems, type KybConfig } from "@/engine";

// spec 06 KybClassification. The document types come from config/kyb.yaml (items 3-13).
export function kybClassificationSchema(kyb: KybConfig) {
  const types = uploadableItems(kyb).map((i) => i.id);
  return z.object({
    document_type: z.enum(["unrecognised", ...types] as [string, ...string[]]),
    company_name: z.string().nullable(),
    registration_number: z.string().nullable(),
    registered_address: z.string().nullable(),
    issue_date: z.string().nullable().describe("YYYY-MM-DD or null"),
    persons: z.array(
      z.object({
        name: z.string(),
        role: z.enum(["director", "shareholder", "ubo", "representative"]),
        share_percent: z.number().nullable().describe("Shareholding in percent as printed, null if not stated"),
      }),
    ),
    issues: z.array(z.enum(["PROMPT_INJECTION_SUSPECTED"])),
    issue_notes: z.string(),
    overall_confidence: z.number().describe("0 to 1"),
  });
}
export type KybClassification = z.infer<ReturnType<typeof kybClassificationSchema>>;

// spec 06 CaseMemo: Claude writes the narrative parts. The score restatement, checks and disclaimer
// are attached by code (copied from the engine and rule checks, never computed by the model).
export const memoDraftSchema = z.object({
  summary: z.string().describe("At most 120 words"),
  screening_notes: z.string().describe("Likely match quality per hit (name, DOB, country). Never clear a hit."),
  suggested_edd_requests: z.array(z.string()),
  recommended_action: z.enum(["approve", "edd", "reject", "needs_human_review"]),
});
export type MemoDraft = z.infer<typeof memoDraftSchema>;

export const MEMO_DISCLAIMER = "Advisory only. Decision rests with the analyst.";
export const MEMO_MAX_WORDS = 120;
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
