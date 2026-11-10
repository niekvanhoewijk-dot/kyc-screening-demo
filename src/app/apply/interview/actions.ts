"use server";

import { runTurn, type Card, type TurnOutcome } from "@/agent/interviewer";
import { interviewModelFromEnv } from "@/agent/model";
import { env } from "@/lib/env";
import { portalDeps } from "@/portal/deps";
import { PortalError } from "@/portal/errors";
import { currentApplicant } from "../session";

// One turn of the interviewer. The browser sends earlier turns as plain text (O-80); the server never trusts
// anything else from it, and re-reads the application state through the tools on every turn.

export type TurnResponse = { ok: true; reply: string; outcome: TurnOutcome; card: Card | null } | { ok: false; message: string };

export async function interviewTurnAction(input: { history: unknown; message: string }): Promise<TurnResponse> {
  if (!env.AGENT_ENABLED) return { ok: false, message: "The assistant is not available. Please use the form." };
  const applicant = await currentApplicant();
  if (!applicant) return { ok: false, message: "Your session has ended. Please sign in again." };
  try {
    const r = await runTurn(portalDeps(), { applicantId: applicant.id, history: input.history, message: String(input.message ?? "") }, interviewModelFromEnv());
    return { ok: true, reply: r.reply, outcome: r.outcome, card: r.card };
  } catch (e) {
    if (e instanceof PortalError) return { ok: false, message: e.message };
    throw e;
  }
}
