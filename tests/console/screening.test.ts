import { describe, expect, it } from "vitest";
import { MockScreeningProvider, nameSimilarity } from "@/adapters/screening";

describe("mock screening provider", () => {
  it("scores names ignoring case, accents and word order", () => {
    expect(nameSimilarity("Ada Sample", "SAMPLE ada")).toBe(1);
    expect(nameSimilarity("Zoë Pérez", "Zoe Perez")).toBe(1);
    expect(nameSimilarity("Ada Sample", "Ada Sampel")).toBeGreaterThanOrEqual(0.8);
    expect(nameSimilarity("Ada Sample", "Victor Fictus")).toBeLessThan(0.5);
  });

  it("reports a near-name match with a different DOB as a possible hit", async () => {
    const r = await new MockScreeningProvider().screen({ fullName: "Ada Sample", dateOfBirth: "1990-05-01", countries: ["GR"] });
    expect(r.hits).toEqual([expect.objectContaining({ entryId: "WL-001", category: "sanctions", strength: "possible", match: expect.objectContaining({ dob: "differs", country: "differs" }) })]);
    expect(r.listVersion).toBeTruthy();
  });

  it("reports an exact name and DOB as a strong hit", async () => {
    const r = await new MockScreeningProvider().screen({ fullName: "Petros Demopoulos", dateOfBirth: "1971-08-30", countries: ["GR"] });
    expect(r.hits).toEqual([expect.objectContaining({ entryId: "WL-002", category: "pep", strength: "strong" })]);
  });

  it("returns nothing for an unrelated name", async () => {
    expect((await new MockScreeningProvider().screen({ fullName: "Bo Tester", dateOfBirth: "1990-05-01", countries: ["GR"] })).hits).toEqual([]);
  });
});
