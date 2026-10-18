import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export const kybConfigSchema = z.object({
  version: z.number().int(),
  checklist: z.array(z.object({ id: z.string(), item: z.number().int(), label: z.string(), provided_by: z.literal("portal").optional() })).min(1),
  person_roles: z.array(z.object({ id: z.enum(["representative", "ubo", "shareholder", "director"]), label: z.string() })),
  required_roles: z.array(z.enum(["representative", "ubo", "shareholder", "director"])),
  shareholding_total_percent: z.number().positive(),
  country_tier_to_band: z.record(z.string(), z.string()),
  pep_min_band: z.string(),
});
export type KybConfig = z.infer<typeof kybConfigSchema>;
export type PersonRole = KybConfig["person_roles"][number]["id"];

let cached: KybConfig | undefined;
export function loadKybConfig(file = path.resolve(/* turbopackIgnore: true */ process.cwd(), "config/kyb.yaml")): KybConfig {
  cached ??= kybConfigSchema.parse(parse(fs.readFileSync(file, "utf8")));
  return cached;
}

/** Document checklist items the applicant uploads (everything except portal-provided items). */
export const uploadableItems = (kyb: KybConfig) => kyb.checklist.filter((c) => !c.provided_by);
