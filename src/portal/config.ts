import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const positiveInt = z.number().int().positive();
const option = z.object({ id: z.string().min(1), label: z.string().min(1) });

export const portalConfigSchema = z.object({
  version: z.number().int(),
  otp: z.object({
    length: positiveInt,
    ttl_minutes: positiveInt,
    max_attempts: positiveInt,
    resend_cooldown_seconds: positiveInt,
  }),
  session: z.object({ ttl_days: positiveInt }),
  uploads: z.object({
    max_bytes: positiveInt,
    document_mime: z.array(z.string()).min(1),
    selfie_mime: z.array(z.string()).min(1),
  }),
  face_match: z.object({ max_attempts: positiveInt }),
  poi: z.object({ document_types: z.array(option.extend({ needs_back: z.boolean() })).min(1) }),
  por: z.object({
    max_age_months: positiveInt,
    default_validity_months: positiveInt,
    renewal_notice_days: positiveInt,
    document_types: z.array(option).min(1),
  }),
  questionnaire: z.object({ preferred_languages: z.array(option).min(1) }),
});

export type PortalConfig = z.infer<typeof portalConfigSchema>;

let cached: PortalConfig | undefined;

export function loadPortalConfig(file = path.resolve(/* turbopackIgnore: true */ process.cwd(), "config/portal.yaml")): PortalConfig {
  if (!cached) cached = portalConfigSchema.parse(parse(fs.readFileSync(file, "utf8")));
  return cached;
}
