import { cookies } from "next/headers";
import { portalDeps } from "@/portal/deps";

export const ANALYST_COOKIE = "kyc_analyst";

/** Demo identity: the analyst picks who they are (no real authentication). Used for the audit actor. */
export async function currentAnalyst() {
  const id = (await cookies()).get(ANALYST_COOKIE)?.value;
  return portalDeps().consoleConfig.analysts.find((a) => a.id === id) ?? null;
}
