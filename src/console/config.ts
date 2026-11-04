import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export const consoleConfigSchema = z.object({
  version: z.number().int(),
  analysts: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), name: z.string() })).min(1),
  age_filters_days: z.array(z.number().int().positive()),
  default_mode: z.enum(["mvp1", "mvp2"]),
  simulator: z.object({
    clock_steps: z
      .array(z.union([z.object({ label: z.string(), days: z.number().int().positive() }), z.object({ label: z.string(), months: z.number().int().positive() })]))
      .min(1),
    presets: z.array(
      z.object({
        id: z.string().regex(/^S\d[a-z]?$/),
        label: z.string(),
        note: z.string(),
        clock: z.enum(["demo_date", "amlr"]),
        baseline: z.string().optional(),
        candidate: z.string().optional(),
        cfa: z.enum(["all_prohibited", "follow_fatf"]).optional(),
        delisted: z.enum(["normal_with_note", "hold_auto_high"]).optional(),
        show: z.enum(["por_notice", "por_expired", "threshold_reached", "review_due"]).optional(),
        subject: z.string().optional(),
        event: z.enum(["deposit", "por_replaced", "circumstance_change", "pep_confirmed", "edd_outcome"]).optional(),
        amount: z.number().positive().optional(),
      }),
    ),
  }),
});
export type ConsoleConfig = z.infer<typeof consoleConfigSchema>;

let cached: ConsoleConfig | undefined;
export function loadConsoleConfig(file = path.resolve(/* turbopackIgnore: true */ process.cwd(), "config/console.yaml")): ConsoleConfig {
  cached ??= consoleConfigSchema.parse(parse(fs.readFileSync(file, "utf8")));
  return cached;
}
