import { and, eq, isNull } from "drizzle-orm";
import { documents } from "@/db/schema";
import type { PortalDeps } from "@/portal/deps";

/** Original file names of the current (not superseded) uploads, by kind. */
export function onFileNames(deps: PortalDeps, caseId: string): Partial<Record<(typeof documents.$inferSelect)["kind"], string>> {
  const rows = deps.db
    .select({ kind: documents.kind, name: documents.originalName })
    .from(documents)
    .where(and(eq(documents.caseId, caseId), isNull(documents.supersededAt)))
    .all();
  return Object.fromEntries(rows.map((r) => [r.kind, r.name]));
}
