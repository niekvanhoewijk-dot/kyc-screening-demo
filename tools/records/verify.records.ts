// npm run verify:records -> recomputes every decision-record hash chain in the local database and replays every
// record (engine, human, lifecycle and policy change) under the policy it is pinned to, simulator drafts included
// (spec 08 section 4.4). Fails on any problem.
import { expect, it } from "vitest";
import { replayRecord, verifyChain, type DecisionRecord } from "@/engine";
import { portalDeps } from "@/portal/deps";
import { allRecords } from "@/records/store";
import { policySet } from "@/simulator/policies";

it("verifies decision records", () => {
  const deps = portalDeps();
  const records = allRecords(deps);
  const bySubject = new Map<string, DecisionRecord[]>();
  for (const r of records) bySubject.set(r.subject, [...(bySubject.get(r.subject) ?? []), r]);
  const problems: string[] = [];
  for (const [subject, recs] of bySubject) for (const p of verifyChain(recs)) problems.push(`${subject} #${p.seq}: ${p.problem}`);
  const policies = policySet(deps);
  let replayed = 0;
  for (const r of records) {
    const res = replayRecord(r, policies, deps.kyb);
    replayed++;
    if (!res.reproduced) problems.push(`${r.subject} #${r.seq} ${r.kind}: ${res.differences.join("; ")}`);
  }
  console.log(`\n${records.length} records, ${bySubject.size} subjects, ${replayed} replayed. ${problems.length ? `${problems.length} PROBLEM(S):\n  ${problems.join("\n  ")}` : "All chains intact, all records reproduced."}`);
  expect(problems).toEqual([]);
});
