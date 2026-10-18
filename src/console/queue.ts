import { desc, eq, ne } from "drizzle-orm";
import { applicants, cases, screeningHits } from "@/db/schema";
import type { PortalDeps } from "@/portal/deps";

export type QueueFilters = { band?: string; status?: string; olderThanDays?: number };

export type QueueRow = {
  caseId: string;
  applicant: string;
  email: string;
  status: string;
  submittedAt: string | null;
  ageDays: number | null;
  total: number | null;
  band: string | null;
  route: "reject_recommended" | "edd_required" | "standard";
  openHits: number;
  preReview: { fail: number; flag: number } | null;
};

const DAY_MS = 86_400_000;

/** Analyst queue (spec 01): every non-draft case, oldest submission first, filterable by band, status, age. */
export function listQueue(deps: PortalDeps, filters: QueueFilters = {}): QueueRow[] {
  const now = deps.now().getTime();
  const rows = deps.db
    .select({ c: cases, a: applicants })
    .from(cases)
    .innerJoin(applicants, eq(cases.applicantId, applicants.id))
    .where(ne(cases.status, "draft"))
    .orderBy(desc(cases.submittedAt))
    .all();
  const hits = deps.db.select({ caseId: screeningHits.caseId, status: screeningHits.status }).from(screeningHits).all();

  return rows
    .map(({ c, a }): QueueRow => {
      const risk = c.riskResult as { total?: number; band?: string; decision?: string; edd_required?: boolean } | null;
      const pre = c.preReview as { summary: { fail: number; flag: number } } | null;
      return {
        caseId: c.id,
        applicant: `${a.firstName} ${a.lastName}`,
        email: a.email,
        status: c.status,
        submittedAt: c.submittedAt,
        ageDays: c.submittedAt ? Math.floor((now - Date.parse(c.submittedAt)) / DAY_MS) : null,
        total: risk?.total ?? null,
        band: risk?.band ?? null,
        route: risk?.decision === "reject" ? "reject_recommended" : risk?.edd_required ? "edd_required" : "standard",
        openHits: hits.filter((h) => h.caseId === c.id && h.status === "open").length,
        preReview: pre ? { fail: pre.summary.fail, flag: pre.summary.flag } : null,
      };
    })
    .filter((r) => !filters.band || r.band === filters.band || (filters.band === "none" && r.band === null))
    .filter((r) => !filters.status || r.status === filters.status)
    .filter((r) => filters.olderThanDays === undefined || (r.ageDays ?? 0) >= filters.olderThanDays)
    .sort((x, y) => (x.submittedAt ?? "").localeCompare(y.submittedAt ?? ""));
}
