import { describe, expect, it } from "vitest";
import { loadEngineConfig, loadKybConfig, scoreCompany } from "@/engine";

const config = loadEngineConfig();
const kyb = loadKybConfig();
const person = (id: string, countryOfResidence: string, pep = false) => ({ id, name: `Person ${id}`, countryOfResidence, pep });

// Derived cases for the DEMO default (spec 03 / O-8). Not golden: the requirements define no company scoring.
describe("company risk (demo default)", () => {
  it("low company country and low persons -> Low, no EDD", () => {
    expect(scoreCompany({ countryOfIncorporation: "NL", persons: [person("a", "GR"), person("b", "GB")] }, config, kyb)).toMatchObject({ band: "low", driver: { kind: "company_country" }, edd_required: false });
  });

  it("unassessed country of incorporation -> Medium", () => {
    expect(scoreCompany({ countryOfIncorporation: "FR", persons: [person("a", "GR")] }, config, kyb).band).toBe("medium");
  });

  it("a grey-list resident person drives the company to Auto-High and EDD", () => {
    const s = scoreCompany({ countryOfIncorporation: "NL", persons: [person("a", "GR"), person("b", "KE")] }, config, kyb);
    expect(s).toMatchObject({ band: "auto_high", driver: { kind: "person", id: "b" }, edd_required: true });
  });

  it("a PEP raises that person to at least High (D9)", () => {
    const s = scoreCompany({ countryOfIncorporation: "NL", persons: [person("a", "GR", true)] }, config, kyb);
    expect(s.persons[0]).toMatchObject({ band: "high", raisedBy: "pep" });
    expect(s.band).toBe("high");
  });

  it("incorporation in a call-for-action country -> Prohibited, reject", () => {
    expect(scoreCompany({ countryOfIncorporation: "IR", persons: [person("a", "GR")] }, config, kyb)).toMatchObject({ band: "prohibited", decision: "reject" });
  });
});
