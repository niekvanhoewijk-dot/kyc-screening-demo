"use server";

import { revalidatePath } from "next/cache";
import { portalDeps } from "@/portal/deps";
import { PortalError } from "@/portal/errors";
import { advanceClock, applyPolicy, dryRun, injectEvent, moveClock, resetClock } from "@/simulator/service";
import type { FormState } from "../../apply/form-state";
import { currentAnalyst } from "../analyst-session";
import { readChoice } from "./refs";

// Simulator actions (spec 08 5.1, 5.4, 5.5). Each runs as the signed-in analyst and is audited by the service.

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

async function run(fn: (analyst: string) => string): Promise<FormState> {
  const a = await currentAnalyst();
  if (!a) return { message: "Choose who you are first." };
  let message: string;
  try {
    message = fn(a.id);
  } catch (e) {
    if (e instanceof PortalError) return { message: e.message, fieldErrors: e.fieldErrors };
    throw e;
  }
  revalidatePath("/analyst/simulator");
  revalidatePath("/analyst");
  return { ok: true, message };
}

const recorded = (n: number) => (n ? ` ${n} obligation record${n === 1 ? "" : "s"} written.` : "");

export async function clockAction(_: FormState, fd: FormData): Promise<FormState> {
  return run((a) => {
    const deps = portalDeps();
    const op = str(fd, "op");
    if (op === "reset") {
      const r = resetClock(deps, a);
      return `Clock back to today, ${r.clock.date}.${recorded(r.recorded)}`;
    }
    if (op === "step") {
      const step = deps.consoleConfig.simulator.clock_steps[Number(str(fd, "step"))];
      if (!step) throw new PortalError("VALIDATION", "Unknown clock step.");
      const r = advanceClock(deps, step, a);
      return `Simulated date ${r.clock.date}.${recorded(r.recorded)}`;
    }
    const r = moveClock(deps, str(fd, "date"), a);
    return `Simulated date ${r.clock.date}.${recorded(r.recorded)}`;
  });
}

export async function dryRunAction(_: FormState, fd: FormData): Promise<FormState> {
  return run((a) => {
    const deps = portalDeps();
    const { refs } = readChoice(deps, (k) => str(fd, k) || undefined);
    const { record } = dryRun(deps, refs, a);
    const s = record.outcome.summary ?? {};
    return `Dry run recorded (portfolio record ${record.seq}): ${s.changed ?? 0} of ${s.customers ?? 0} would change, ${s.analyst_review ?? 0} to analyst review. Nothing else was changed.`;
  });
}

export async function applyAction(_: FormState, fd: FormData): Promise<FormState> {
  return run((a) => {
    const deps = portalDeps();
    const { refs } = readChoice(deps, (k) => str(fd, k) || undefined);
    const r = applyPolicy(deps, refs, str(fd, "reason"), a);
    return `Applied ${r.record.policy.id} to demo data: ${r.rescored} re-scored, ${r.record.outcome.summary?.analyst_review ?? 0} to analyst review.${recorded(r.recorded)} Undo with the demo reset.`;
  });
}

const amount = (fd: FormData, k: string) => {
  const raw = str(fd, k).replace(/[,\s$]/g, "");
  return raw === "" ? NaN : Number(raw);
};

export async function eventAction(_: FormState, fd: FormData): Promise<FormState> {
  return run((a) => {
    const deps = portalDeps();
    const type = str(fd, "type");
    const event =
      type === "deposit" ? { type, amount: amount(fd, "amount") }
      : type === "por_replaced" ? { type, issued_at: str(fd, "issued_at") }
      : type === "circumstance_change" ? { type, field: str(fd, "field"), value: str(fd, "field") === "country" ? str(fd, "country_value").trim().toUpperCase() : str(fd, "factor_value"), at: str(fd, "at") }
      : type === "edd_outcome" ? { type, documented_annual_amount: fd.get("noSof") === "on" ? null : amount(fd, "documented") }
      : { type };
    const subject = str(fd, "subject");
    const r = injectEvent(deps, subject, event, a);
    const due = r.obligations.length ? `Due now: ${r.obligations.length} obligation${r.obligations.length === 1 ? "" : "s"}.` : "No obligations due.";
    return `Event applied to ${subject}. ${due}${recorded(r.recorded)}`;
  });
}
