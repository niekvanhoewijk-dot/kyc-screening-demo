import { z } from "zod";
import { addDays, addMonths } from "./dates";
import { factorAnswersSchema, evaluateIndividual, type ReasonCode } from "./decision-record";
import { recalculateEdd, depositTriggersEdd, type EddResult } from "./edd";
import { SCORED_FACTORS } from "./factors";
import type { Policy } from "./policy";

// Lifecycle of existing customers (docs/spec/08 sections 2 and 5.3). Pure: no I/O, no clock.
// Time alone never changes a band: the clock creates obligations; bands change only when a fact
// (an event) or the policy changes.

const isoDate = z.iso.date();

export const bookCustomerSchema = z.object({
  id: z.string().min(1),
  label: z.literal("Synthetic"),
  note: z.string().optional(),
  country: z.string().regex(/^[A-Z][A-Z]$/),
  pep: z.boolean(),
  us_tax_resident: z.boolean(),
  only_source_of_wealth: z.boolean(),
  factor_answers: factorAnswersSchema,
  onboarded_at: isoDate,
  /** Start of the AMLR Art. 26 review clock; onboarding counts as the first review (O-44). */
  last_review_at: isoDate,
  por_issued_at: isoDate.nullable(),
  por_expires_at: isoDate.nullable(),
  deposited_to_date: z.number().nonnegative(),
  /** Operative deposit threshold (set at onboarding, possibly raised by EDD); null = none (Prohibited). */
  threshold: z.number().nonnegative().nullable(),
  /** Set by a circumstance_change event: an event-driven review is due from this date (Art. 26(3)). */
  event_review_at: isoDate.optional(),
  last_edd: z.custom<EddResult>().optional(),
});
export type BookCustomer = z.infer<typeof bookCustomerSchema>;

export const bookSchema = z
  .object({ description: z.string(), demo_date: isoDate, customers: z.array(bookCustomerSchema).min(1) })
  .refine((b) => new Set(b.customers.map((c) => c.id)).size === b.customers.length, { message: "duplicate customer id" });
export type Book = z.infer<typeof bookSchema>;

export const parseBook = (raw: unknown): Book => bookSchema.parse(raw);

/** POR settings reused from config/portal.yaml (spec 02), not repeated in the policy. */
export type LifecycleRules = { por_notice_days: number; por_validity_months: number };
export const lifecycleRules = (portal: { por: { renewal_notice_days: number; default_validity_months: number } }): LifecycleRules => ({
  por_notice_days: portal.por.renewal_notice_days,
  por_validity_months: portal.por.default_validity_months,
});

// ---------- Evaluation under a policy ----------

export type CustomerEvaluation = {
  total: number | null;
  band: string | null;
  edd_required: boolean;
  /** Initial threshold these answers get under the policy (the customer's operative one is `threshold` on the book row). */
  threshold: number | null;
  route: "standard" | "edd_required" | "reject";
  reason_codes: ReasonCode[];
};

/** Score, band, EDD requirement, initial threshold and route the policy gives this customer's facts. */
export function evaluateCustomer(customer: BookCustomer, policy: Policy): CustomerEvaluation {
  const { outcome, reason_codes } = evaluateIndividual(
    { country: customer.country, factor_answers: customer.factor_answers, pep: customer.pep, us_tax_resident: customer.us_tax_resident, only_source_of_wealth: customer.only_source_of_wealth },
    policy,
  );
  return {
    total: outcome.total ?? null,
    band: outcome.band ?? null,
    edd_required: outcome.edd_required ?? false,
    threshold: outcome.threshold ?? null,
    route: outcome.route as CustomerEvaluation["route"],
    reason_codes,
  };
}

// ---------- Obligations (the clock) ----------

export type ObligationKind = "por_notice" | "por_expired" | "threshold_reached" | "review_due";
/** Legal basis, mapped to a label in the UI: Full v3 POR and EDD rules, AMLR Art. 26(2)(a), 26(2)(b), 26(3). */
export type ObligationBasis = "full_v3_por" | "full_v3_edd" | "amlr_26_2_a" | "amlr_26_2_b" | "amlr_26_3";
export type Obligation = {
  subject: string;
  kind: ObligationKind;
  code: ReasonCode;
  /** null = due now (a deposit reached the threshold). */
  due_on: string | null;
  basis: ObligationBasis;
  /** preview = AMLR obligation before the Regulation applies (D15). Full v3 rules are always in force. */
  flag: "preview" | "in_force";
  effect: null | { status: "expired_por"; blocks: ["deposits", "withdrawals"] } | { status: "edd_requested"; route: "edd" };
};

/** Obligations due on `asOf` (an ISO date), in a fixed order: POR, threshold, periodic review, event review. */
export function evaluateLifecycle(customer: BookCustomer, policy: Policy, asOf: string, rules: LifecycleRules): Obligation[] {
  const out: Obligation[] = [];
  const base = { subject: customer.id, effect: null } as const;

  const expires = customer.por_expires_at;
  if (expires && asOf >= expires)
    out.push({ ...base, kind: "por_expired", code: "LC_POR_EXPIRED", due_on: expires, basis: "full_v3_por", flag: "in_force", effect: { status: "expired_por", blocks: ["deposits", "withdrawals"] } });
  else if (expires && asOf >= addDays(expires, -rules.por_notice_days))
    out.push({ ...base, kind: "por_notice", code: "LC_POR_EXPIRY_NOTICE", due_on: expires, basis: "full_v3_por", flag: "in_force" });

  if (customer.threshold !== null && depositTriggersEdd(customer.deposited_to_date, customer.threshold))
    out.push({ ...base, kind: "threshold_reached", code: "LC_THRESHOLD_REACHED", due_on: null, basis: "full_v3_edd", flag: "in_force", effect: { status: "edd_requested", route: "edd" } });

  const review = policy.policy.settings.periodic_review;
  if (review.enabled) {
    const flag = asOf < review.regulatory_effective_from ? "preview" : "in_force";
    // O-43: customers subject to EDD get the annual interval; everyone else the standard one.
    const edd = evaluateCustomer(customer, policy).edd_required;
    const due = addMonths(customer.last_review_at, edd ? review.interval_months.edd : review.interval_months.standard);
    if (asOf >= due)
      out.push({ ...base, kind: "review_due", code: edd ? "LC_REVIEW_DUE_EDD_ANNUAL" : "LC_REVIEW_DUE_STANDARD_5Y", due_on: due, basis: edd ? "amlr_26_2_a" : "amlr_26_2_b", flag });
    const event = customer.event_review_at;
    if (event && event > customer.last_review_at && asOf >= event)
      out.push({ ...base, kind: "review_due", code: "LC_CIRCUMSTANCE_CHANGE", due_on: event, basis: "amlr_26_3", flag });
  }
  return out;
}

// ---------- Events (facts) ----------

export const lifecycleEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("deposit"), amount: z.number().positive() }),
  z.object({ type: z.literal("por_replaced"), issued_at: isoDate }),
  z.object({ type: z.literal("circumstance_change"), field: z.enum(["country", ...SCORED_FACTORS]), value: z.string().min(1), at: isoDate }),
  z.object({ type: z.literal("pep_confirmed") }),
  z.object({ type: z.literal("edd_outcome"), documented_annual_amount: z.number().nonnegative().nullable() }),
]);
export type LifecycleEvent = z.infer<typeof lifecycleEventSchema>;

/**
 * Applies an event to a customer's facts and returns the new customer; the input is never mutated.
 * A list change is not a customer event: the simulator switches the candidate policy instead.
 */
export function applyEvent(customer: BookCustomer, event: LifecycleEvent, ctx: { policy: Policy; rules: LifecycleRules }): BookCustomer {
  const c: BookCustomer = structuredClone(customer);
  switch (event.type) {
    case "deposit":
      c.deposited_to_date += event.amount;
      return c;
    case "por_replaced":
      c.por_issued_at = event.issued_at;
      c.por_expires_at = addMonths(event.issued_at, ctx.rules.por_validity_months);
      return c;
    case "circumstance_change":
      if (event.field === "country") c.country = event.value;
      else c.factor_answers[event.field] = event.value;
      c.event_review_at = event.at;
      return c;
    case "pep_confirmed":
      c.pep = true;
      return c;
    case "edd_outcome": {
      const r = recalculateEdd(
        { source_of_funds: c.factor_answers.source_of_funds, only_source_of_wealth: c.only_source_of_wealth, documented_annual_amount: event.documented_annual_amount, deposited_to_date: c.deposited_to_date },
        ctx.policy,
      );
      c.last_edd = r;
      if (r.outcome === "new_threshold") c.threshold = r.new_threshold;
      return c;
    }
  }
}

// ---------- Policy change (blast radius) ----------

export type ChangeField = "band" | "edd" | "threshold" | "route";
export type Change = {
  subject: string;
  before: CustomerEvaluation;
  after: Omit<CustomerEvaluation, "route"> & { route: CustomerEvaluation["route"] | "analyst_review" };
  changed: ChangeField[];
  /** D13: a customer the candidate would reject goes to an analyst; a policy change never closes a relationship. */
  analyst_review: boolean;
};
export type PolicyDiff = {
  rows: Change[];
  summary: { customers: number; changed: number; band_changed: number; newly_edd: number; no_longer_edd: number; threshold_changed: number; analyst_review: number; unchanged: number };
};

const CHANGE_FIELDS: [ChangeField, keyof CustomerEvaluation][] = [
  ["band", "band"],
  ["edd", "edd_required"],
  ["threshold", "threshold"],
  ["route", "route"],
];

/** Every customer evaluated under a baseline and a candidate policy, with what would change. Writes nothing. */
export function diffUnderPolicy(book: BookCustomer[], baseline: Policy, candidate: Policy): PolicyDiff {
  const rows: Change[] = book.map((c) => {
    const before = evaluateCustomer(c, baseline);
    const raw = evaluateCustomer(c, candidate);
    const changed = CHANGE_FIELDS.filter(([, key]) => before[key] !== raw[key]).map(([name]) => name);
    const review = changed.length > 0 && raw.route === "reject";
    const after: Change["after"] = review ? { ...raw, route: "analyst_review", reason_codes: [...raw.reason_codes, "LC_POLICY_CHANGE_REVIEW"] } : raw;
    return { subject: c.id, before, after, changed, analyst_review: review };
  });
  const count = (pred: (r: Change) => boolean) => rows.filter(pred).length;
  return {
    rows,
    summary: {
      customers: rows.length,
      changed: count((r) => r.changed.length > 0),
      band_changed: count((r) => r.changed.includes("band")),
      newly_edd: count((r) => !r.before.edd_required && r.after.edd_required),
      no_longer_edd: count((r) => r.before.edd_required && !r.after.edd_required),
      threshold_changed: count((r) => r.changed.includes("threshold")),
      analyst_review: count((r) => r.analyst_review),
      unchanged: count((r) => r.changed.length === 0),
    },
  };
}
