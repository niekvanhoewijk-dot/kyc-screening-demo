import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  applyEvent,
  diffUnderPolicy,
  draftPolicy,
  evaluateCustomer,
  evaluateDecision,
  evaluateLifecycle,
  lifecycleEventSchema,
  lifecycleRules,
  loadKybConfig,
  loadPolicies,
  parseBook,
  type BookCustomer,
} from "@/engine";
import { loadPortalConfig } from "@/portal/config";

const policies = loadPolicies();
const P1 = policies.byId("P1");
const P2 = policies.byId("P2");
const rules = lifecycleRules(loadPortalConfig());
const book = parseBook(JSON.parse(fs.readFileSync(path.resolve("fixtures/portfolio/book.json"), "utf8")));
const customer = (id: string) => book.customers.find((c) => c.id === id)!;
const ctx = { policy: P2, rules };

describe("dates", () => {
  it("adds months and clamps to the end of the month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2027-01-31", 13)).toBe("2028-02-29");
    expect(addMonths("2022-03-01", 60)).toBe("2027-03-01");
    expect(addMonths("2026-11-18", -6)).toBe("2026-05-18");
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-18", -14)).toBe("2026-11-04");
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
  });
});

describe("synthetic book (spec 08 section 5.2)", () => {
  it("labels every customer Synthetic and has unique ids", () => {
    expect(book.customers.every((c) => c.label === "Synthetic")).toBe(true);
    expect(new Set(book.customers.map((c) => c.id)).size).toBe(book.customers.length);
  });
  it("covers the countries, PEPs and dates the spec asks for", () => {
    const countries = new Set(book.customers.map((c) => c.country));
    for (const code of ["BG", "CI", "CD", "MC", "VN", "MM", "KP", "IR", "KE", "GB", "GR", "NL"]) expect(countries.has(code)).toBe(true);
    expect(book.customers.filter((c) => c.pep).length).toBeGreaterThanOrEqual(2);
    const amlr = P2.policy.settings.periodic_review.regulatory_effective_from;
    const { edd, standard } = P2.policy.settings.periodic_review.interval_months;
    const reviews = book.customers.map((c) => c.last_review_at);
    for (const months of [edd, standard]) {
      const cut = addMonths(amlr, -months);
      expect(reviews.some((d) => d < cut)).toBe(true);
      expect(reviews.some((d) => d > cut)).toBe(true);
    }
    const notice = addDays(book.demo_date, rules.por_notice_days);
    expect(book.customers.some((c) => c.por_expires_at && c.por_expires_at >= book.demo_date && c.por_expires_at <= notice)).toBe(true);
    expect(book.customers.some((c) => c.threshold !== null && c.deposited_to_date < c.threshold && c.threshold - c.deposited_to_date <= 1000)).toBe(true);
  });
});

describe("evaluateCustomer", () => {
  it("matches the decision-record path for the same inputs (one engine, two callers)", () => {
    const kyb = loadKybConfig();
    for (const c of book.customers) {
      const r = evaluateDecision(
        "engine.rescore",
        { type: "individual", country: c.country, factor_answers: c.factor_answers, pep: c.pep, us_tax_resident: c.us_tax_resident, only_source_of_wealth: c.only_source_of_wealth },
        P2,
        kyb,
      );
      const e = evaluateCustomer(c, P2);
      expect(e).toEqual({ total: r.outcome.total, band: r.outcome.band, edd_required: r.outcome.edd_required, threshold: r.outcome.threshold, route: r.outcome.route, reason_codes: r.reason_codes });
    }
  });
  it("time alone does not change a band: no date input", () => {
    expect(evaluateCustomer.length).toBe(2);
  });
});

describe("applyEvent (facts only, pure)", () => {
  it("does not mutate the customer it is given", () => {
    const before = structuredClone(customer("BK-16"));
    applyEvent(customer("BK-16"), { type: "deposit", amount: 700 }, ctx);
    expect(customer("BK-16")).toEqual(before);
  });
  it("pep_confirmed re-scores to at least High (D9)", () => {
    const after = applyEvent(customer("BK-11"), { type: "pep_confirmed" }, ctx);
    expect(evaluateCustomer(customer("BK-11"), P2).band).toBe("low");
    expect(evaluateCustomer(after, P2)).toMatchObject({ band: "high", edd_required: true });
    expect(evaluateCustomer(after, P2).reason_codes).toContain("RC_PEP_FORCES_HIGH");
  });
  it("circumstance_change re-scores and opens an event-driven review (AMLR Art. 26(3))", () => {
    const moved = applyEvent(customer("BK-11"), { type: "circumstance_change", field: "country", value: "KE", at: "2026-11-10" }, ctx);
    expect(evaluateCustomer(moved, P2).band).toBe("auto_high");
    expect(evaluateLifecycle(moved, P2, "2026-11-09", rules).some((o) => o.code === "LC_CIRCUMSTANCE_CHANGE")).toBe(false);
    const due = evaluateLifecycle(moved, P2, "2026-11-10", rules).find((o) => o.code === "LC_CIRCUMSTANCE_CHANGE");
    expect(due).toMatchObject({ kind: "review_due", due_on: "2026-11-10", basis: "amlr_26_3", flag: "preview" });
  });
  it("an EDD outcome that does not cover the deposits keeps the threshold", () => {
    const deposited = applyEvent(customer("BK-16"), { type: "deposit", amount: 700 }, ctx);
    const after = applyEvent(deposited, { type: "edd_outcome", documented_annual_amount: 10000 }, ctx);
    expect(after.threshold).toBe(deposited.threshold);
    expect(after.last_edd).toMatchObject({ outcome: "return_excess_and_block" });
    expect(evaluateLifecycle(after, P2, book.demo_date, rules).map((o) => o.code)).toContain("LC_THRESHOLD_REACHED");
  });
  it("list_change is not a customer event (the simulator switches the candidate policy)", () => {
    expect(lifecycleEventSchema.safeParse({ type: "list_change", policy_id: "P2" }).success).toBe(false);
  });
});

describe("evaluateLifecycle", () => {
  it("takes review intervals from the policy, not code", () => {
    const shorter = draftPolicy(P2, { periodic_review: { ...P2.policy.settings.periodic_review, interval_months: { edd: 6, standard: 60 } } });
    const c = customer("BK-14"); // PEP, last review 2026-09-01
    expect(evaluateLifecycle(c, P2, "2027-03-01", rules).some((o) => o.kind === "review_due")).toBe(false);
    expect(evaluateLifecycle(c, shorter, "2027-03-01", rules).find((o) => o.kind === "review_due")?.due_on).toBe("2027-03-01");
  });
  it("produces no review obligations when periodic review is disabled", () => {
    const off = draftPolicy(P2, { periodic_review: { ...P2.policy.settings.periodic_review, enabled: false } });
    expect(book.customers.flatMap((c) => evaluateLifecycle(c, off, "2030-01-01", rules)).some((o) => o.kind === "review_due")).toBe(false);
  });
  it("treats a customer without a proof of residence on file as having no POR obligation", () => {
    const c: BookCustomer = { ...customer("BK-15"), por_issued_at: null, por_expires_at: null };
    expect(evaluateLifecycle(c, P2, "2026-12-01", rules).filter((o) => o.kind.startsWith("por"))).toEqual([]);
  });
});

describe("diffUnderPolicy", () => {
  it("is empty when both sides are the same policy", () => {
    const d = diffUnderPolicy(book.customers, P2, P2);
    expect(d.summary.changed).toBe(0);
    expect(d.summary.unchanged).toBe(book.customers.length);
  });
  it("never auto-rejects an existing customer (D13)", () => {
    const d = diffUnderPolicy(book.customers, draftPolicy(P2, { call_for_action_treatment: "follow_fatf" }), P2);
    const changed = d.rows.filter((r) => r.changed.length);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((r) => r.after.route !== "reject")).toBe(true);
    expect(changed.every((r) => r.after.reason_codes.includes("LC_POLICY_CHANGE_REVIEW"))).toBe(true);
  });
  it("leaves P1 and P2 unchanged (drafts never mutate a published policy)", () => {
    const hashes = [P1.policy.hash, P2.policy.hash];
    diffUnderPolicy(book.customers, P1, draftPolicy(P2, { recently_delisted_treatment: "hold_auto_high" }));
    expect([P1.policy.hash, P2.policy.hash]).toEqual(hashes);
  });
});
