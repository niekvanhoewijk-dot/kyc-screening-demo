import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { countryRiskSchema, loadEngineConfig, riskMatrixSchema } from "@/engine";

const read = (f: string) => parse(fs.readFileSync(path.resolve("config", f), "utf8"));

describe("config loader", () => {
  it("loads and validates both config files", () => {
    const config = loadEngineConfig();
    expect(config.matrix.version).toBe(1);
    expect(config.countries.meta.list_version).toBeTruthy();
  });

  it("rejects a matrix with a factor tier that has no points", () => {
    const raw = read("risk-matrix.yaml");
    raw.factors.source_of_funds[0].tier = "extreme";
    expect(() => riskMatrixSchema.parse(raw)).toThrow();
  });

  it("rejects bands with a gap", () => {
    const raw = read("risk-matrix.yaml");
    raw.bands[1].min += 1;
    expect(() => riskMatrixSchema.parse(raw)).toThrow(/contiguous/);
  });

  it("rejects a country listed twice across lists", () => {
    const raw = read("country-risk.yaml");
    raw.demo_seed_low.push({ code: "IR", name: "Iran" });
    expect(() => countryRiskSchema.parse(raw)).toThrow(/IR/);
  });

  it("rejects country data without as_of / list_version", () => {
    const raw = read("country-risk.yaml");
    delete raw.meta.as_of;
    expect(() => countryRiskSchema.parse(raw)).toThrow();
  });
});
