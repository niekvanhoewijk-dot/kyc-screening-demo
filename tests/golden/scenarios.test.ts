import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyEvent,
  diffUnderPolicy,
  draftPolicy,
  evaluateLifecycle,
  lifecycleRules,
  loadPolicies,
  parseBook,
  type BookCustomer,
  type LifecycleEvent,
  type Policy,
  type PolicySettings,
} from "@/engine";
import { loadPortalConfig } from "@/portal/config";

// Scenarios S1 to S5 (docs/spec/08 section 6). The expected values were derived by the Python oracle
// (tools/verify_golden.py --derive-scenarios) and pinned. This runner mirrors the oracle's run_scenario.

type PolicySpec = string | { base: string; settings: Partial<PolicySettings> };
type Step = { as_of?: string; subject?: string; event?: LifecycleEvent };
type ScenarioInput =
  | { kind: "diff"; book: string; baseline: PolicySpec; candidate: PolicySpec }
  | { kind: "lifecycle"; book: string; policy: "in_force" | PolicySpec; subjects: "all" | string[]; only?: string[]; facts?: boolean; steps: Step[] };

const policies = loadPolicies();
const rules = lifecycleRules(loadPortalConfig());
const FACT_KEYS = ["country", "pep", "deposited_to_date", "threshold", "por_issued_at", "por_expires_at", "event_review_at", "last_edd"] as const;

const resolvePolicy = (spec: PolicySpec): Policy =>
  typeof spec === "string" ? policies.byId(spec) : draftPolicy(policies.byId(spec.base), spec.settings, `${spec.base}-draft`);

function runScenario(input: ScenarioInput) {
  const customers = parseBook(JSON.parse(fs.readFileSync(path.resolve(input.book), "utf8"))).customers;
  if (input.kind === "diff") return diffUnderPolicy(customers, resolvePolicy(input.baseline), resolvePolicy(input.candidate));

  const book = new Map<string, BookCustomer>(customers.map((c) => [c.id, c]));
  const subjects = input.subjects === "all" ? [...book.keys()] : input.subjects;
  let asOf = "";
  const steps = input.steps.map((step) => {
    asOf = step.as_of ?? asOf;
    const policy = input.policy === "in_force" ? policies.inForce(asOf) : resolvePolicy(input.policy);
    if (step.event && step.subject) book.set(step.subject, applyEvent(book.get(step.subject)!, step.event, { policy, rules }));
    const obligations = subjects.flatMap((s) => evaluateLifecycle(book.get(s)!, policy, asOf, rules)).filter((o) => !input.only || input.only.includes(o.kind));
    const out: Record<string, unknown> = { as_of: asOf, policy: policy.policy.id, obligations };
    if (input.facts)
      out.facts = Object.fromEntries(
        subjects.map((s) => {
          const c = book.get(s)! as Record<string, unknown>;
          return [s, Object.fromEntries(FACT_KEYS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]]))];
        }),
      );
    return out;
  });
  return { steps };
}

const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, "scenarios.json"), "utf8")) as {
  cases: { id: string; input: ScenarioInput; expect: Record<string, unknown> }[];
};

describe("scenarios.json (pinned from the oracle)", () => {
  for (const c of cases) it(c.id, () => expect(runScenario(c.input)).toEqual(c.expect));
});
