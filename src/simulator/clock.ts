import { eq } from "drizzle-orm";
import { z } from "zod";
import { settings } from "@/db/schema";
import { isoDay } from "@/engine";
import { audit } from "@/lib/audit";
import { PortalError } from "@/portal/errors";
import type { PortalDeps } from "@/portal/deps";

// Simulated clock (docs/spec/08 section 5.1, O-46). Stored as setting `sim.now`; no row = real time.
// Read ONLY by the simulator and the lifecycle evaluation it runs. OTP expiry, sessions, intake checks
// and scoring of new applicants keep the wall clock (deps.now) and never import this module.

const KEY = "sim.now";

export type SimClock = { date: string; simulated: boolean };

export function simClock(deps: Pick<PortalDeps, "db" | "now">): SimClock {
  const row = deps.db.select().from(settings).where(eq(settings.key, KEY)).get();
  return row ? { date: row.value, simulated: true } : { date: isoDay(deps.now().toISOString()), simulated: false };
}

export function setSimDate(deps: Pick<PortalDeps, "db" | "now">, day: string, analystId: string): SimClock {
  if (!z.iso.date().safeParse(day).success) throw new PortalError("VALIDATION", "Enter a date as yyyy-mm-dd.", { date: ["Enter a valid date"] });
  const from = simClock(deps);
  const now = deps.now().toISOString();
  const by = `analyst:${analystId}` as const;
  deps.db.insert(settings).values({ key: KEY, value: day, updatedAt: now, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value: day, updatedAt: now, updatedBy: by } }).run();
  audit(deps.db, deps.now(), by, "sim.clock_set", null, { from: from.date, to: day });
  return { date: day, simulated: true };
}

export function resetSimClock(deps: Pick<PortalDeps, "db" | "now">, analystId: string): SimClock {
  const from = simClock(deps);
  deps.db.delete(settings).where(eq(settings.key, KEY)).run();
  if (from.simulated) audit(deps.db, deps.now(), `analyst:${analystId}`, "sim.clock_reset", null, { from: from.date });
  return simClock(deps);
}
