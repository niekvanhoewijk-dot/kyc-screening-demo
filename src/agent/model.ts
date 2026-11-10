import { ReplayCache } from "@/documents/replay-cache";
import { env } from "@/lib/env";
import { sdkCreateCall, type InterviewModel } from "./interviewer";

// The interviewer's model from the environment: replay (default, offline) or live API calls (DEMO_MODE=live).

let cached: InterviewModel | undefined;
export function interviewModelFromEnv(): InterviewModel {
  cached ??= env.DEMO_MODE === "live"
    ? { mode: "live", model: env.CLAUDE_MODEL, create: sdkCreateCall(), cache: new ReplayCache() }
    : { mode: "replay", model: env.CLAUDE_MODEL, cache: new ReplayCache() };
  return cached;
}
