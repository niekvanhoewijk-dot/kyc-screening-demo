import { describe, expect, it } from "vitest";
import { loadEngineConfig, resolveCountry } from "@/engine";

const config = loadEngineConfig();

describe("country resolver", () => {
  it.each([
    ["IR", "prohibited", "fatf_call_for_action"],
    ["KE", "auto_high", "fatf_increased_monitoring"],
    ["GR", "low", "demo_seed_low"],
    ["DZ", "medium", "default"],
  ])("%s -> %s via %s", (code, tier, list) => {
    const r = resolveCountry(code, config);
    expect(r.tier).toBe(tier);
    expect(r.list).toBe(list);
  });

  it("carries source, as_of and list_version", () => {
    const r = resolveCountry("KE", config);
    expect(r.as_of).toBe(config.countries.meta.as_of);
    expect(r.list_version).toBe(config.countries.meta.list_version);
    expect(r.source.length).toBeGreaterThan(0);
  });

  it("flags unlisted countries as unassessed", () => {
    expect(resolveCountry("FR", config).unassessed).toBe(true);
    expect(resolveCountry("GB", config).unassessed).toBe(false);
  });

  it("is case-insensitive on the ISO code", () => {
    expect(resolveCountry("ir", config).tier).toBe("prohibited");
  });
});
