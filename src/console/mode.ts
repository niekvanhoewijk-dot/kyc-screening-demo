import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { PortalDeps } from "@/portal/deps";

export type Mode = "mvp1" | "mvp2";
export const MODE_LABEL: Record<Mode, string> = {
  mvp1: "MVP 1: manual checks",
  mvp2: "MVP 2: Claude pre-review",
};

/** MVP 1 = analysts check everything by hand, Claude off. MVP 2 = Claude pre-review shown (spec 01). */
export function getMode(deps: PortalDeps): Mode {
  const row = deps.db.select().from(settings).where(eq(settings.key, "mode")).get();
  return (row?.value as Mode | undefined) ?? deps.consoleConfig.default_mode;
}

export function setMode(deps: PortalDeps, mode: Mode, analystId: string) {
  const from = getMode(deps);
  if (from === mode) return;
  const now = deps.now().toISOString();
  deps.db
    .insert(settings)
    .values({ key: "mode", value: mode, updatedAt: now, updatedBy: `analyst:${analystId}` })
    .onConflictDoUpdate({ target: settings.key, set: { value: mode, updatedAt: now, updatedBy: `analyst:${analystId}` } })
    .run();
  audit(deps.db, deps.now(), `analyst:${analystId}`, "mode.changed", null, { from, to: mode });
}
