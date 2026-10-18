import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { applicants, cases } from "@/db/schema";
import { portalDeps } from "@/portal/deps";
import { devDecideAction } from "./actions";

export const dynamic = "force-dynamic";

// Temporary dev tool so 2.1.8 and the no-go screen can be reached before the analyst console (Phase 4).
export default function DevCasesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const rows = portalDeps()
    .db.select({ c: cases, a: applicants })
    .from(cases)
    .innerJoin(applicants, eq(cases.applicantId, applicants.id))
    .orderBy(desc(cases.updatedAt))
    .all();
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <h1>Dev: decide cases</h1>
      <div className="banner info">Developer tool, replaced by the analyst console in Phase 4. Every decision is written to the audit log as analyst:dev-tool.</div>
      <table>
        <thead>
          <tr><th>Applicant</th><th>Status</th><th>Engine</th><th>Decide</th></tr>
        </thead>
        <tbody>
          {rows.map(({ c, a }) => {
            const risk = c.riskResult as { total?: number; band?: string; decision?: string; reason?: string } | null;
            const thr = c.thresholdResult as { threshold?: number } | null;
            return (
              <tr key={c.id}>
                <td>{a.firstName} {a.lastName}<br /><small>{a.email}</small></td>
                <td>{c.status}{c.decisionReason && <><br /><small>{c.decisionReason}</small></>}</td>
                <td>
                  {risk ? <>{risk.band ?? "-"} {risk.total !== undefined && `(${risk.total})`}{risk.decision && <><br /><small>{risk.decision}: {risk.reason}</small></>}{thr?.threshold !== undefined && <><br /><small>threshold {thr.threshold}</small></>}</> : "-"}
                </td>
                <td>
                  {["submitted", "in_review", "edd_submitted"].includes(c.status) ? (
                    <form action={devDecideAction} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <input type="hidden" name="caseId" value={c.id} />
                      <select name="decision" defaultValue="approve" aria-label="Decision">
                        <option value="approve">Approve</option>
                        <option value="edd">Request EDD</option>
                        <option value="reject">Reject</option>
                      </select>
                      <input name="reason" placeholder="Reason (required)" required aria-label="Reason" />
                      <button className="btn" type="submit">Record</button>
                    </form>
                  ) : "-"}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={4}>No cases yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
