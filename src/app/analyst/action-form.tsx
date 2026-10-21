"use client";

import { useActionState, type ReactNode } from "react";
import { FormMessage, Submit } from "@/components/form";
import { initialState, type FormState } from "../apply/form-state";

/** A small form bound to a console server action, showing its result inline. */
export function ActionForm({
  action,
  hidden,
  children,
  submit,
  pending,
  arrow = false,
  variant,
  buttons,
  className = "stack",
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  children?: ReactNode;
  submit?: string;
  pending?: string;
  arrow?: boolean;
  variant?: "outline";
  /** Several submit buttons (e.g. name="action" values), replacing the single submit. */
  buttons?: ReactNode;
  className?: string;
}) {
  const [state, run] = useActionState(action, initialState);
  return (
    <form action={run} className={className}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      {buttons ?? (
        <div>
          <Submit pending={pending ?? "Working…"} arrow={arrow} variant={variant}>{submit}</Submit>
        </div>
      )}
      <FormMessage state={state} />
    </form>
  );
}
