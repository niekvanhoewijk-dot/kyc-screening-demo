import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { draftPolicy, loadEngineConfig, loadPolicies, parsePolicies, resolveCountry } from "@/engine";

const policies = loadPolicies();
const cfg = (f: string) => parse(fs.readFileSync(path.resolve("config", f), "utf8"));

describe("policy versions (spec 08 section 3)", () => {
  it("loads P1 (June list) as the default and P2 (October list) with different content hashes", () => {
    const [p1, p2] = [policies.byId("P1"), policies.byId("P2")];
    expect(loadEngineConfig().policy.id).toBe("P1");
    expect(p1.countries.meta.list_version).toBe("FATF-2026-06");
    expect(p2.countries.meta.list_version).toBe("FATF-2026-10");
    expect(p1.policy.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(p1.policy.hash).not.toBe(p2.policy.hash);
  });

  it("picks the policy in force by effective date", () => {
    expect(policies.inForce("2026-10-29T23:00:00Z").policy.id).toBe("P1");
    expect(policies.inForce("2026-10-30T00:00:00Z").policy.id).toBe("P2");
    expect(policies.inForce("2027-07-10").policy.id).toBe("P2");
  });

  it("rejects review intervals longer than the AMLR Art. 26(2) maxima", () => {
    const raw = cfg("policy/policies.yaml");
    raw.policies[0].settings = { ...raw.policies[0].settings, periodic_review: { ...raw.policies[0].settings.periodic_review, interval_months: { edd: 13, standard: 60 } } };
    expect(() => parsePolicies(raw, cfg)).toThrow(/exceeds the legal maximum/);
  });

  it("a draft gets a new hash and never changes the published policy", () => {
    const p2 = policies.byId("P2");
    const before = p2.policy.hash;
    const draft = draftPolicy(p2, { call_for_action_treatment: "follow_fatf" });
    expect(draft.policy.hash).not.toBe(before);
    expect(p2.policy.hash).toBe(before);
    expect(p2.policy.settings.call_for_action_treatment).toBe("all_prohibited");
  });
});

describe("country resolution under policy settings (spec 08 3.3)", () => {
  const p1 = policies.byId("P1");
  const p2 = policies.byId("P2");
  const follow = draftPolicy(p2, { call_for_action_treatment: "follow_fatf" });
  const hold = draftPolicy(p2, { recently_delisted_treatment: "hold_auto_high" });

  it("BG: Auto-High on the June list, default tier with a note after delisting, held when the knob says so", () => {
    expect(resolveCountry("BG", p1)).toMatchObject({ tier: "auto_high", reason_code: "RC_COUNTRY_INCREASED_MONITORING", policy_id: "P1" });
    expect(resolveCountry("BG", p2)).toMatchObject({ tier: "medium", list: "default", reason_code: "RC_COUNTRY_RECENTLY_DELISTED", policy_id: "P2" });
    expect(resolveCountry("BG", hold)).toMatchObject({ tier: "auto_high", reason_code: "RC_COUNTRY_RECENTLY_DELISTED_HELD" });
  });

  it("the Myanmar knob: all_prohibited by default; follow_fatf accepts MM through EDD, KP and IR stay prohibited", () => {
    expect(resolveCountry("MM", p2)).toMatchObject({ tier: "prohibited", reason_code: "RC_COUNTRY_CALL_FOR_ACTION_EDD" });
    expect(resolveCountry("MM", follow)).toMatchObject({ tier: "auto_high", reason_code: "RC_COUNTRY_CALL_FOR_ACTION_EDD" });
    for (const code of ["KP", "IR"]) expect(resolveCountry(code, follow)).toMatchObject({ tier: "prohibited", reason_code: "RC_COUNTRY_CALL_FOR_ACTION_COUNTERMEASURES" });
  });

  it("low and unassessed countries carry their reason codes", () => {
    expect(resolveCountry("GR", p2).reason_code).toBe("RC_COUNTRY_DEMO_SEED_LOW");
    expect(resolveCountry("FR", p2).reason_code).toBe("RC_COUNTRY_UNASSESSED");
  });
});
