import { describe, expect, it } from "vitest";
import { availableActions, type GuardInput } from "@/console/guards";

const base: GuardInput = { status: "in_review", risk: { band: "low", edd_required: false }, eddResult: null, hits: [] };
const allowed = (g: Partial<GuardInput>) =>
  Object.fromEntries(Object.entries(availableActions({ ...base, ...g })).map(([k, v]) => [k, v.allowed]));

describe("analyst action guards", () => {
  it("needs a started review before any decision", () => {
    expect(allowed({ status: "submitted" })).toEqual({ start_review: true, approve: false, request_edd: false, reject: false, recalculate_edd: false });
  });

  it("allows every decision on a clean low-risk case", () => {
    expect(allowed({})).toMatchObject({ approve: true, request_edd: true, reject: true });
  });

  it("engine hard rule reject: only reject", () => {
    expect(allowed({ risk: { decision: "reject", reason: "us_tax_resident" } })).toMatchObject({ approve: false, request_edd: false, reject: true });
    expect(availableActions({ ...base, risk: { decision: "reject", reason: "us_tax_resident" } }).approve.why).toMatch(/us_tax_resident/);
  });

  it("blocks approval while screening hits are open or a sanctions match is confirmed", () => {
    expect(allowed({ hits: [{ status: "open", category: "pep" }] }).approve).toBe(false);
    expect(allowed({ hits: [{ status: "false_positive", category: "sanctions" }] }).approve).toBe(true);
    expect(allowed({ hits: [{ status: "true_match", category: "sanctions" }] }).approve).toBe(false);
  });

  it("High / Auto-High need a completed EDD with a new threshold", () => {
    const high = { risk: { band: "high", edd_required: true } };
    expect(allowed(high).approve).toBe(false);
    expect(allowed({ ...high, status: "edd_submitted", eddResult: { result: { outcome: "new_threshold" } } }).approve).toBe(true);
    expect(allowed({ ...high, status: "edd_submitted", eddResult: { result: { outcome: "return_excess_and_block" } } }).approve).toBe(false);
  });

  it("EDD recalculation is only possible once the applicant has sent documents", () => {
    expect(allowed({}).recalculate_edd).toBe(false);
    expect(allowed({ status: "edd_submitted" }).recalculate_edd).toBe(true);
  });
});
