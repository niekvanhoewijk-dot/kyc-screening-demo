import { describe, expect, it } from "vitest";
import { loadEngineConfig, recalculateEdd, scoreApplicant } from "@/engine";

const config = loadEngineConfig();
const lowApplicant = {
  country: "GR",
  deposit_12m: "lt_20k",
  source_of_funds: "salary",
  employment_status: "employed",
  occupation_industry: "education",
  annual_income: "lt_50k",
  net_worth: "lt_50k",
};

describe("scoring", () => {
  it("returns a per-factor breakdown that sums to the total", () => {
    const r = scoreApplicant(lowApplicant, config);
    if (!("total" in r)) throw new Error("unexpected reject");
    expect(r.breakdown.map((b) => b.factor)).toContain("country");
    expect(r.breakdown.reduce((s, b) => s + b.points, 0)).toBe(r.total);
  });

  it("routes prohibited countries to reject", () => {
    const r = scoreApplicant({ ...lowApplicant, country: "IR" }, config);
    expect(r).toMatchObject({ band: "prohibited", decision: "reject", reason: "prohibited_band" });
  });

  it("requires EDD for high and auto-high bands, not for low", () => {
    expect(scoreApplicant(lowApplicant, config)).toMatchObject({ edd_required: false });
    expect(scoreApplicant({ ...lowApplicant, country: "KE" }, config)).toMatchObject({ edd_required: true });
    expect(scoreApplicant({ ...lowApplicant, pep: true }, config)).toMatchObject({ edd_required: true });
  });

  it("PEP never lowers a band above high", () => {
    const r = scoreApplicant({ ...lowApplicant, country: "KE", pep: true }, config);
    expect(r).toMatchObject({ band: "auto_high" });
    expect(r).not.toHaveProperty("forced_by");
  });

  it("unknown occupation falls back to the default tier", () => {
    const r = scoreApplicant({ ...lowApplicant, occupation_industry: "farming" }, config);
    expect(r).toMatchObject({ total: 8 });
  });

  it("rejects an unknown answer for a closed list", () => {
    expect(() => scoreApplicant({ ...lowApplicant, employment_status: "astronaut" }, config)).toThrow();
  });
});

describe("EDD", () => {
  // docs/spec/05 + O-12: equality = new threshold equal to deposited, headroom 0.
  it("treats covered == deposited as a new threshold with zero headroom", () => {
    const r = recalculateEdd(
      { source_of_funds: "salary", documented_annual_amount: 125000, deposited_to_date: 100000 },
      config,
    );
    expect(r).toEqual({ outcome: "new_threshold", new_threshold: 100000, headroom: 0 });
  });
});
