import { env } from "@/lib/env";
import { loadPortalConfig } from "@/portal/config";
import { ClaudeDocumentReader, sdkParseCall } from "./claude-reader";
import type { CheckRules } from "./checks";
import { loadDocumentReadingConfig } from "./config";
import type { CallLog } from "./reader";

/** Reader configured from env: CLAUDE_MODEL, DEMO_MODE (live calls the API and records; replay serves the cache). */
export function documentReaderFromEnv(log?: (entry: CallLog) => void, mode: "live" | "replay" = env.DEMO_MODE) {
  return new ClaudeDocumentReader({
    model: env.CLAUDE_MODEL,
    mode,
    config: loadDocumentReadingConfig(),
    parse: mode === "live" ? sdkParseCall() : undefined,
    log,
  });
}

export function checkRulesFromConfig(): CheckRules {
  const por = loadPortalConfig().por;
  return {
    confidence_threshold: loadDocumentReadingConfig().confidence_threshold,
    por_max_age_months: por.max_age_months,
    por_default_validity_months: por.default_validity_months,
  };
}
