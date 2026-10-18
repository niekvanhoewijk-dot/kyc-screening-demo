import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export const documentReadingConfigSchema = z.object({
  version: z.number().int(),
  prompt_version: z.string().min(1),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  max_tokens: z.number().int().positive(),
  max_attempts: z.number().int().positive(),
  confidence_threshold: z.number().gt(0).max(1),
  refusal_fallbacks: z.enum(["default", "off"]),
});

export type DocumentReadingConfig = z.infer<typeof documentReadingConfigSchema>;

let cached: DocumentReadingConfig | undefined;
export function loadDocumentReadingConfig(file = path.resolve(process.cwd(), "config/document-reading.yaml")) {
  cached ??= documentReadingConfigSchema.parse(parse(fs.readFileSync(file, "utf8")));
  return cached;
}
