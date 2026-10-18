import Link from "next/link";
import { completedSteps, stepsFor, type StepCase, type StepId } from "@/portal/steps";

export function Stepper({ current, c }: { current: StepId; c: StepCase }) {
  const done = completedSteps(c);
  return (
    <ol className="stepper" aria-label="Progress">
      {stepsFor(c).map((s) => {
        const state = s.id === current ? "current" : done[s.id] ? "done" : "todo";
        return (
          <li key={s.id} data-state={state} aria-current={state === "current" ? "step" : undefined}>
            {state === "done" && c.status === "draft" ? <Link href={s.path}>{s.title}</Link> : s.title}
          </li>
        );
      })}
    </ol>
  );
}
