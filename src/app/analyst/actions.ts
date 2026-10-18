"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { decide, recalculateEddForCase, requestEdd, startReview, triageHit } from "@/console/actions";
import { setMode, type Mode } from "@/console/mode";
import { runPreReview } from "@/documents/pre-review";
import { audit } from "@/lib/audit";
import { portalDeps } from "@/portal/deps";
import { PortalError } from "@/portal/errors";
import type { FormState } from "../apply/form-state";
import { ANALYST_COOKIE, currentAnalyst } from "./analyst-session";

async function analystId() {
  const a = await currentAnalyst();
  if (!a) throw new PortalError("VALIDATION", "Choose who you are first.");
  return a.id;
}

/** Runs a console action; applicant-safe errors come back as form state, everything is re-rendered. */
async function run(caseId: string | null, fn: (analyst: string) => unknown | Promise<unknown>, ok: string): Promise<FormState> {
  try {
    await fn(await analystId());
  } catch (e) {
    if (e instanceof PortalError) return { message: e.message, fieldErrors: e.fieldErrors };
    throw e;
  }
  revalidatePath("/analyst");
  if (caseId) revalidatePath(`/analyst/cases/${caseId}`);
  return { ok: true, message: ok };
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function chooseAnalystAction(fd: FormData) {
  const id = str(fd, "analyst");
  if (!portalDeps().consoleConfig.analysts.some((a) => a.id === id)) return;
  (await cookies()).set(ANALYST_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/" });
  revalidatePath("/analyst");
}

export async function setModeAction(fd: FormData) {
  const a = await currentAnalyst();
  if (!a) return;
  setMode(portalDeps(), str(fd, "mode") as Mode, a.id);
  revalidatePath("/analyst", "layout");
}

export async function startReviewAction(_: FormState, fd: FormData) {
  const caseId = str(fd, "caseId");
  return run(caseId, (a) => startReview(portalDeps(), caseId, a), "Review started.");
}

export async function triageAction(_: FormState, fd: FormData) {
  const caseId = str(fd, "caseId");
  return run(caseId, (a) => triageHit(portalDeps(), caseId, str(fd, "hitId"), str(fd, "verdict") as "false_positive" | "true_match", str(fd, "reason"), a), "Hit triaged.");
}

export async function decisionAction(_: FormState, fd: FormData) {
  const caseId = str(fd, "caseId");
  const action = str(fd, "action");
  const reason = str(fd, "reason");
  return run(
    caseId,
    (a) => (action === "edd" ? requestEdd(portalDeps(), caseId, reason, a) : decide(portalDeps(), caseId, action as "approve" | "reject", reason, a)),
    action === "edd" ? "EDD requested from the applicant." : `Case ${action === "approve" ? "approved" : "rejected"}.`,
  );
}

export async function eddRecalcAction(_: FormState, fd: FormData) {
  const caseId = str(fd, "caseId");
  const none = fd.get("noSof") === "on";
  const amount = (k: string) => (str(fd, k).trim() === "" ? NaN : Number(str(fd, k).replace(/[,\s$]/g, "")));
  return run(
    caseId,
    (a) => {
      const documented = none ? null : amount("documentedAnnualAmount");
      const deposited = amount("depositedToDate");
      if ((documented !== null && Number.isNaN(documented)) || Number.isNaN(deposited))
        throw new PortalError("VALIDATION", "Enter both amounts, or tick 'No source of funds provided'.");
      return recalculateEddForCase(portalDeps(), caseId, { documentedAnnualAmount: documented, depositedToDate: deposited }, a);
    },
    "EDD recalculated by the rules engine.",
  );
}

export async function runPreReviewAction(_: FormState, fd: FormData) {
  const caseId = str(fd, "caseId");
  return run(
    caseId,
    async (a) => {
      const deps = portalDeps();
      audit(deps.db, deps.now(), `analyst:${a}`, "prereview.requested", `case:${caseId}`);
      await runPreReview(deps, caseId);
    },
    "Claude pre-review finished.",
  );
}
