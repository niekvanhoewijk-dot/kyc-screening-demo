import { describe, expect, it } from "vitest";
import { canOpen, resumeStep } from "@/portal/steps";

const base = { status: "draft", overviewSeenAt: null, identity: null, residence: null, questionnaire: null };

describe("step machine", () => {
  it("resumes at the first incomplete step", () => {
    expect(resumeStep(base)).toBe("overview");
    expect(resumeStep({ ...base, overviewSeenAt: "x", identity: { complete: true } })).toBe("residence");
    expect(resumeStep({ ...base, overviewSeenAt: "x", identity: { complete: false } })).toBe("identity");
  });

  it("lets drafts revisit completed steps but not skip ahead", () => {
    const c = { ...base, overviewSeenAt: "x", identity: { complete: true } };
    expect(canOpen("identity", c)).toBe(true);
    expect(canOpen("residence", c)).toBe(true);
    expect(canOpen("questionnaire", c)).toBe(false);
  });

  it("locks every step but the status page after submission", () => {
    const c = { ...base, status: "submitted", overviewSeenAt: "x", identity: { complete: true } };
    expect(canOpen("identity", c)).toBe(false);
    expect(canOpen("check", c)).toBe(true);
  });
});
