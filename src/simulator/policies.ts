import { eq } from "drizzle-orm";
import { policyDrafts, settings } from "@/db/schema";
import { draftPolicy, policySettingsSchema, withDrafts, type Policy, type PolicySet, type PolicySettings } from "@/engine";
import { audit } from "@/lib/audit";
import { PortalError } from "@/portal/errors";
import type { PortalDeps } from "@/portal/deps";
import { simClock } from "./clock";

// Policies in the simulator (spec 08 sections 3.1 and 5.5): published versions, drafts built from a knob change,
// and the policy last applied to demo data. Publishing is out of scope: a draft is never in force for new applicants.

/** A published policy id, or a published base with changed settings (a draft). */
export type PolicyRef = string | { base: string; settings: Partial<PolicySettings> };

const APPLIED_KEY = "sim.applied_policy";
/** Characters of the content hash in a draft id: enough to tell drafts apart on screen. */
const DRAFT_ID_HASH_CHARS = 8;

/** Published policies plus every draft saved in this demo, so records pinned to a draft still resolve. */
export function policySet(deps: Pick<PortalDeps, "db" | "policies">): PolicySet {
  const drafts = deps.db
    .select()
    .from(policyDrafts)
    .all()
    .map((d) => draftPolicy(deps.policies.byId(d.base), policySettingsSchema.parse(d.settings), d.id));
  return withDrafts(deps.policies, drafts);
}

/**
 * Resolves a reference to a policy. A draft gets a content-addressed id (base + hash prefix), so the same knobs
 * always give the same draft; a draft identical to its base is the base. `saveAs` (the actor) persists it for replay.
 */
export function resolvePolicy(deps: Pick<PortalDeps, "db" | "policies" | "now">, ref: PolicyRef, opts: { saveAs?: string } = {}): Policy {
  if (typeof ref === "string") {
    try {
      return policySet(deps).byId(ref);
    } catch {
      throw new PortalError("VALIDATION", `Unknown policy ${ref}.`, { policy: ["Choose a policy"] });
    }
  }
  const base = deps.policies.byId(ref.base);
  const probe = draftPolicy(base, ref.settings);
  if (probe.policy.hash === base.policy.hash) return base;
  const id = `${base.policy.id}-draft-${probe.policy.hash.slice(0, DRAFT_ID_HASH_CHARS)}`;
  const draft = draftPolicy(base, ref.settings, id);
  if (opts.saveAs) {
    deps.db
      .insert(policyDrafts)
      .values({ id, base: base.policy.id, settings: draft.policy.settings, hash: draft.policy.hash, createdAt: deps.now().toISOString(), createdBy: opts.saveAs })
      .onConflictDoNothing()
      .run();
  }
  return draft;
}

/** The policy the book is evaluated under: the one last applied in the simulator, else the one in force on the simulated date. */
export function effectivePolicy(deps: Pick<PortalDeps, "db" | "policies" | "now">): Policy {
  const applied = deps.db.select().from(settings).where(eq(settings.key, APPLIED_KEY)).get();
  return applied ? policySet(deps).byId(applied.value) : deps.policies.inForce(simClock(deps).date);
}

export function setAppliedPolicy(deps: Pick<PortalDeps, "db" | "now">, policy: Policy, analystId: string) {
  const now = deps.now().toISOString();
  const by = `analyst:${analystId}` as const;
  deps.db
    .insert(settings)
    .values({ key: APPLIED_KEY, value: policy.policy.id, updatedAt: now, updatedBy: by })
    .onConflictDoUpdate({ target: settings.key, set: { value: policy.policy.id, updatedAt: now, updatedBy: by } })
    .run();
  audit(deps.db, deps.now(), by, "sim.applied_policy_set", null, { policy: policy.policy.id, hash: policy.policy.hash });
}
