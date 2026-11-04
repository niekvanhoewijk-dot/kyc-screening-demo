import type { PolicySettings } from "@/engine";
import type { PortalDeps } from "@/portal/deps";
import { effectivePolicy, type PolicyRef } from "@/simulator/policies";

// Simulator policy choice, carried in the URL (the page) and in hidden fields (the actions):
// baseline = a policy id; candidate = a published base plus the two knobs, which may make it a draft.

export type Get = (key: string) => string | undefined;

const CFA = ["all_prohibited", "follow_fatf"] as const;
const DELISTED = ["normal_with_note", "hold_auto_high"] as const;
const pick = <T extends string>(allowed: readonly T[], v: string | undefined): T | undefined => (allowed as readonly string[]).includes(v ?? "") ? (v as T) : undefined;

export type Choice = {
  /** Resolved baseline id; `baselineParam` is "" when the analyst left it on the current book policy. */
  baseline: string;
  baselineParam: string;
  candidateBase: string;
  knobs: Pick<PolicySettings, "call_for_action_treatment" | "recently_delisted_treatment">;
  refs: { baseline: PolicyRef; candidate: PolicyRef };
};

/** Defaults: baseline = the policy the book is under; candidate = the same, so nothing changes until a knob moves. */
export function readChoice(deps: PortalDeps, get: Get): Choice {
  const effective = effectivePolicy(deps);
  const published = deps.policies.all.map((p) => p.policy.id);
  const baselineParam = get("baseline") ?? "";
  const baseline = baselineParam || effective.policy.id;
  const effectiveBase = published.includes(effective.policy.id) ? effective.policy.id : effective.policy.id.split("-draft-")[0]!;
  const candidateBase = published.includes(get("candidate") ?? "") ? get("candidate")! : effectiveBase;
  const defaults = (get("candidate") ? deps.policies.byId(candidateBase) : effective).policy.settings;
  const knobs = {
    call_for_action_treatment: pick(CFA, get("cfa")) ?? defaults.call_for_action_treatment,
    recently_delisted_treatment: pick(DELISTED, get("delisted")) ?? defaults.recently_delisted_treatment,
  };
  return { baseline, baselineParam, candidateBase, knobs, refs: { baseline, candidate: { base: candidateBase, settings: knobs } } };
}

/** The query string for the current choice, plus extras (e.g. the subject whose records are open). */
export function choiceQuery(c: Choice, extra: Record<string, string> = {}) {
  return new URLSearchParams({ baseline: c.baselineParam, candidate: c.candidateBase, cfa: c.knobs.call_for_action_treatment, delisted: c.knobs.recently_delisted_treatment, ...extra }).toString();
}
