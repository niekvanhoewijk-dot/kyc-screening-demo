import { z } from "zod";

export const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  DEMO_MODE: z.enum(["live", "replay"]).default("live"),
  DATABASE_PATH: z.string().min(1).default("./data/demo.sqlite"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings from .env files as unset so defaults apply.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  return envSchema.parse(cleaned);
}

export const env = parseEnv(process.env);
