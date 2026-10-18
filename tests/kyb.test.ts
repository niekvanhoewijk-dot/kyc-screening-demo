import { describe, expect, it } from "vitest";
import type { KybClassification } from "@/documents/kyb-schemas";
import { loadKybConfig, uploadableItems } from "@/engine";
import { gapList, type GapInput } from "@/kyb/gaps";

const kyb = loadKybConfig();
const allDocs = uploadableItems(kyb).map((i) => ({ id: i.id, name: `${i.id}.png`, tag: i.id, classification: null }));
const base = (over: Partial<GapInput> = {}): GapInput => ({
  company: { legalName: "Sample Holdings B.V.", registrationNumber: "SAMPLE-12345" },
  persons: [
    { id: "rep", fullName: "Ada Sample", roles: ["representative", "ubo", "shareholder", "director"], sharePercent: 60, isApplicant: true, hasPoi: false, hasPor: false },
    { id: "bo", fullName: "Bo Sample", roles: ["shareholder", "director"], sharePercent: 40, isApplicant: false, hasPoi: true, hasPor: true },
  ],
  applicantDocs: { poi: true, por: true },
  docs: allDocs,
  ...over,
});
const codes = (i: GapInput) => gapList(i, kyb).map((g) => g.code);
const cls = (over: Partial<KybClassification>): KybClassification => ({
  document_type: "register_of_members", company_name: "Sample Holdings B.V.", registration_number: "SAMPLE-12345", registered_address: null, issue_date: null,
  persons: [{ name: "Ada Sample", role: "shareholder", share_percent: 60 }, { name: "Bo Sample", role: "shareholder", share_percent: 40 }],
  issues: [], issue_notes: "", overall_confidence: 0.9, ...over,
});

describe("KYB gap list", () => {
  it("a complete pack has no gaps", () => expect(gapList(base(), kyb)).toEqual([]));

  it("lists each missing checklist item", () => {
    const g = gapList(base({ docs: allDocs.filter((d) => d.tag !== "good_standing" && d.tag !== "register_of_members") }), kyb);
    expect(g.filter((x) => x.code === "KYB_DOCUMENT_MISSING").map((x) => x.item)).toEqual(["good_standing", "register_of_members"]);
  });

  it("counts an untagged file Claude classified as covering the item", () => {
    const docs = [...allDocs.filter((d) => d.tag !== "register_of_members"), { id: "u", name: "scan.png", tag: null, classification: cls({}) }];
    expect(codes(base({ docs }))).toEqual([]);
  });

  it("flags persons without POI/POR and missing required roles", () => {
    const persons = [{ ...base().persons[0]!, roles: ["representative", "shareholder"], sharePercent: 100 }, { ...base().persons[1]!, roles: ["director"], sharePercent: null, hasPor: false }];
    const g = gapList(base({ persons }), kyb);
    expect(g.map((x) => x.detail)).toEqual(expect.arrayContaining([expect.stringMatching(/No Ultimate Beneficial Owner/), expect.stringMatching(/Bo Sample: proof of residence missing/)]));
  });

  it("flags declared shareholdings that do not add up", () => {
    const persons = base().persons.map((p) => (p.id === "bo" ? { ...p, sharePercent: 30 } : p));
    expect(codes(base({ persons }))).toEqual(["KYB_SHAREHOLDING_NOT_100"]);
  });

  it("flags a shareholder in the register who is not on the KYC list, and register totals off 100", () => {
    const docs = [...allDocs.filter((d) => d.tag !== "register_of_members"), { id: "r", name: "register.png", tag: "register_of_members", classification: cls({ persons: [{ name: "Ada Sample", role: "shareholder", share_percent: 60 }, { name: "Cy Hidden", role: "shareholder", share_percent: 30 }] }) }];
    expect(codes(base({ docs }))).toEqual(expect.arrayContaining(["KYB_PERSON_WITHOUT_KYC", "KYB_SHAREHOLDING_NOT_100"]));
  });

  it("flags a tag that disagrees with the classification (once, as an inconsistency) and a company-name mismatch", () => {
    const docs = [...allDocs.filter((d) => d.tag !== "good_standing"), { id: "g", name: "gs.png", tag: "good_standing", classification: cls({ document_type: "articles_of_association", company_name: "Other Ltd", persons: [] }) }];
    const g = gapList(base({ docs }), kyb);
    // Claude only flags: the applicant's tag still counts, the analyst resolves the disagreement.
    expect(g.map((x) => x.code)).toEqual([null, "NAME_MISMATCH"]);
    expect(g[0]!.detail).toMatch(/uploaded as "Certified Certificate of Good Standing/);
  });
});
