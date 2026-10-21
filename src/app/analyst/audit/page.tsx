import { desc } from "drizzle-orm";
import Link from "next/link";
import { auditLog } from "@/db/schema";
import { portalDeps } from "@/portal/deps";
import { actorLabel, describe, when } from "../audit-text";

export const dynamic = "force-dynamic";
const SHOWN = 200;

// Audit trail across all cases (AnalystNav "Audit trail"). Read-only view of audit_log.
export default function AuditPage() {
  const deps = portalDeps();
  const rows = deps.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(SHOWN).all();
  const analysts = deps.consoleConfig.analysts;
  return (
    <>
      <header className="head" style={{ gap: 10 }}>
        <span className="eyebrow">Everything that happened</span>
        <h1 className="title">Audit trail</h1>
        <p className="lede" style={{ fontSize: 15 }}>Newest first, the latest {SHOWN} entries. Every state change, Claude call and analyst action is logged with a time and an actor.</p>
      </header>
      <ol className="audit-list">
        {rows.map((a) => (
          <li key={a.id}>
            <span className="when">{when(a.ts)}</span>
            <span className="who">{actorLabel(a.actor, analysts, a.action)}</span>
            <span className="what">
              {describe(a)}
              {a.entity?.startsWith("case:") && <> <Link className="link" style={{ fontSize: 13 }} href={`/analyst/cases/${a.entity.slice("case:".length)}`}>Open case</Link></>}
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="muted">No entries yet.</li>}
      </ol>
    </>
  );
}
