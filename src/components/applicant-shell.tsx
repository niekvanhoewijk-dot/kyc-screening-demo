import Link from "next/link";
import type { ReactNode } from "react";
import { getDemoState } from "@/demo/prefill";
import { env } from "@/lib/env";
import { portalDeps } from "@/portal/deps";
import { completedSteps, stepsFor, type StepCase, type StepId } from "@/portal/steps";
import { LeftPanel, type PanelStep } from "./left-panel";

// Applicant frame (docs/design boards A02-A10): LeftPanel + content column.
// The board stepper is the full journey 2.1.1-2.1.8; companies get their extra steps in between.

export type JourneyStep = "create" | "verify" | StepId | "confirmation";

export function journey(c: StepCase | null, current: JourneyStep): { steps: PanelStep[]; index: number } {
  const appSteps = stepsFor(c ?? {});
  const done = c ? completedSteps(c) : null;
  const list: { id: JourneyStep; label: string; href?: string; isDone: boolean }[] = [
    { id: "create", label: "Create account", isDone: current !== "create" },
    { id: "verify", label: "Verify email", isDone: !!c },
    ...appSteps.map((s) => ({ id: s.id as JourneyStep, label: s.id === "check" ? "Check" : s.title, href: c?.status === "draft" ? s.path : undefined, isDone: !!done?.[s.id] })),
    { id: "confirmation", label: "Confirmation", isDone: c?.status === "approved" },
  ];
  const index = list.findIndex((s) => s.id === current);
  return {
    index,
    steps: list.map((s, i) => ({ id: s.id, label: s.label, href: s.href, state: i === index ? "current" : s.isDone || i < index ? "done" : "todo" })),
  };
}

export function ApplicantShell({
  panelTitle,
  panelBody,
  c,
  current,
  eyebrow,
  title,
  lede,
  narrow,
  center,
  children,
}: {
  panelTitle: string;
  panelBody: string;
  c: StepCase | null;
  /** Journey position; null hides the stepper (e.g. the not-approved screen). */
  current: JourneyStep | null;
  /** Overrides "Step n of m". */
  eyebrow?: string | null;
  title: ReactNode;
  lede?: ReactNode;
  narrow?: boolean;
  center?: boolean;
  children?: ReactNode;
}) {
  const j = current ? journey(c, current) : null;
  const label = eyebrow === undefined && j ? `Step ${j.index + 1} of ${j.steps.length}` : eyebrow;
  // Demo Mode (docs/spec/11): says so on every screen it fills in. Says nothing about the outcome.
  const demo = current !== null && current !== "confirmation" && (!c || c.status === "draft" || c.status === "edd_requested") && getDemoState(portalDeps()).on;
  return (
    <div className="frame">
      <LeftPanel title={panelTitle} body={panelBody} steps={j?.steps} />
      <main className={`content${center ? " center" : ""}`}>
        <div className={`col${narrow ? " narrow" : ""}`}>
          <div className="head">
            {label && <span className="eyebrow">{label}</span>}
            <h1 className="title">{title}</h1>
            {lede && <p className="lede">{lede}</p>}
          </div>
          {demo && <p className="banner"><strong>Demo Mode is on.</strong> Everything on this screen is filled in for you, and sample documents attach themselves. Just press the button.</p>}
          {children}
          {env.AGENT_ENABLED && c?.persona === "individual" && c.status === "draft" && (current === "identity" || current === "residence" || current === "questionnaire") && (
            <p className="hint">
              Prefer to answer in a chat? <Link href="/apply/interview" className="link">Answer with an AI assistant</Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

/** Path of the step before `step` for this persona (the board's "Back" link). */
export function backPath(step: StepId, c: StepCase): string | undefined {
  const steps = stepsFor(c);
  const i = steps.findIndex((s) => s.id === step);
  return i > 0 ? steps[i - 1]!.path : undefined;
}
