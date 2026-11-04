import { asc, desc, eq } from "drizzle-orm";
import { decisionRecords } from "@/db/schema";
import {
  decisionRecordSchema,
  evaluateDecision,
  sealRecord,
  type DecisionInputs,
  type DecisionKind,
  type DecisionRecord,
  type Policy,
  type PolicyResolver,
} from "@/engine";
import { newId } from "@/lib/ids";
import type { PortalDeps } from "@/portal/deps";

// Decision record store (docs/spec/08 section 4). The outcome is always computed by evaluateDecision, the same
// function replay uses, so a record cannot claim an outcome the engine would not give for its inputs.

type AppendArgs = {
  subject: string;
  kind: DecisionKind;
  policy: Policy;
  inputs: DecisionInputs;
  decided_by: string;
  analyst_reason?: string;
  /** Simulated time, for simulator runs only (spec 08 5.1). */
  at_sim?: string | null;
  /** Resolves the baseline of a policy.* record (drafts included). */
  resolve?: PolicyResolver;
};

export function appendRecord(deps: Pick<PortalDeps, "db" | "now" | "kyb">, args: AppendArgs): DecisionRecord {
  const { outcome, reason_codes } = evaluateDecision(args.kind, args.inputs, args.policy, deps.kyb, args.resolve);
  return deps.db.transaction((tx) => {
    const last = tx.select().from(decisionRecords).where(eq(decisionRecords.subject, args.subject)).orderBy(desc(decisionRecords.seq)).get();
    const record = sealRecord({
      id: newId(),
      subject: args.subject,
      seq: (last?.seq ?? 0) + 1,
      kind: args.kind,
      policy: { id: args.policy.policy.id, hash: args.policy.policy.hash },
      inputs: args.inputs,
      outcome,
      reason_codes,
      decided_by: args.decided_by,
      ...(args.analyst_reason ? { analyst_reason: args.analyst_reason } : {}),
      at_wall: deps.now().toISOString(),
      at_sim: args.at_sim ?? null,
      prev_hash: last?.hash ?? null,
    });
    tx.insert(decisionRecords)
      .values({ id: record.id, subject: record.subject, seq: record.seq, kind: record.kind, policyId: record.policy.id, record, hash: record.hash, prevHash: record.prev_hash, atWall: record.at_wall })
      .run();
    return record;
  });
}

/** A subject's records in order. Parsed from the stored JSON; the stored hash column is not trusted here. */
export function recordsFor(deps: Pick<PortalDeps, "db">, subject: string): DecisionRecord[] {
  return deps.db.select().from(decisionRecords).where(eq(decisionRecords.subject, subject)).orderBy(asc(decisionRecords.seq)).all().map((r) => decisionRecordSchema.parse(r.record));
}

export function allRecords(deps: Pick<PortalDeps, "db">): DecisionRecord[] {
  return deps.db.select().from(decisionRecords).orderBy(asc(decisionRecords.subject), asc(decisionRecords.seq)).all().map((r) => decisionRecordSchema.parse(r.record));
}
