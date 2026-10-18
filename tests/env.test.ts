import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

describe("env", () => {
  it("applies defaults", () => {
    const env = parseEnv({});
    expect(env.CLAUDE_MODEL).toBe("claude-sonnet-5-5");
    expect(env.DEMO_MODE).toBe("live");
  });

  it("treats empty strings as unset", () => {
    expect(parseEnv({ CLAUDE_MODEL: "" }).CLAUDE_MODEL).toBe("claude-sonnet-5-5");
  });

  it("rejects an unknown DEMO_MODE", () => {
    expect(() => parseEnv({ DEMO_MODE: "offline" })).toThrow();
  });
});
