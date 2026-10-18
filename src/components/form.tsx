"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/apply/form-state";

export function Field({
  name,
  label,
  hint,
  state,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  state: FormState;
  children: ReactNode;
}) {
  const errors = state.fieldErrors?.[name];
  return (
    <div className="field" data-invalid={errors?.length ? "" : undefined}>
      <label htmlFor={name}>{label}</label>
      {hint && <span className="hint">{hint}</span>}
      {children}
      {errors?.map((e) => (
        <span key={e} className="error" id={`${name}-error`} role="alert">
          {e}
        </span>
      ))}
    </div>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <div className={`banner ${state.ok ? "ok" : "error"}`} role={state.ok ? "status" : "alert"}>
      {state.message}
    </div>
  );
}

export function Submit({ children, pending: pendingLabel = "Saving…" }: { children: ReactNode; pending?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Value for defaultValue: what the applicant just typed, else what is saved. */
export const v = (state: FormState, saved: Record<string, unknown> | null | undefined, key: string): string => {
  const typed = state.values?.[key];
  if (typed !== undefined) return typed;
  const s = saved?.[key];
  return s === undefined || s === null ? "" : String(s);
};
