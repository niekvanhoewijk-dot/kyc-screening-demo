import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Every state change, Claude call and analyst action lands here (CLAUDE.md: audit trail on everything).
// Case and applicant tables arrive in Phase 2 / 4.
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: text("ts").notNull(), // ISO 8601, UTC
  actor: text("actor").notNull(), // e.g. "applicant:<id>", "analyst:<id>", "system", "claude"
  action: text("action").notNull(),
  entity: text("entity"), // e.g. "case:<id>"
  payload: text("payload", { mode: "json" }),
});
