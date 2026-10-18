import { auditLog } from "@/db/schema";
import type { Db } from "@/db/client";

export type Actor = `applicant:${string}` | `analyst:${string}` | "system" | "engine" | "claude";

export function audit(db: Db, now: Date, actor: Actor, action: string, entity: string | null, payload?: unknown) {
  db.insert(auditLog)
    .values({ ts: now.toISOString(), actor, action, entity, payload: payload ?? null })
    .run();
}
