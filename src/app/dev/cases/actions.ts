"use server";

import { revalidatePath } from "next/cache";
import { portalDeps } from "@/portal/deps";
import { recordDecision, type Decision } from "@/portal/decision";
import { PortalError } from "@/portal/errors";

export async function devDecideAction(fd: FormData): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Dev tool disabled");
  try {
    recordDecision(portalDeps(), String(fd.get("caseId")), String(fd.get("decision")) as Decision, String(fd.get("reason") ?? ""), "dev-tool");
  } catch (e) {
    if (!(e instanceof PortalError)) throw e;
    console.warn(`[dev decide] ${e.message}`);
  }
  revalidatePath("/dev/cases");
}
