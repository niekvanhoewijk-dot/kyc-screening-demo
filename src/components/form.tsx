"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/apply/form-state";
import { ArrowIcon, Ticked, UploadIcon } from "./icons";

export function Field({
  name,
  label,
  hint,
  optional,
  state,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  /** Adds the grey "(optional)" suffix from the boards. */
  optional?: boolean;
  state: FormState;
  children: ReactNode;
}) {
  const errors = state.fieldErrors?.[name];
  return (
    <div className="field" data-invalid={errors?.length ? "" : undefined}>
      {label && (
        <label htmlFor={name}>
          {label}
          {optional && <span className="optional"> (optional)</span>}
        </label>
      )}
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

export function Submit({
  children,
  pending: pendingLabel = "Saving…",
  arrow = true,
  variant,
  name,
  value,
}: {
  children: ReactNode;
  pending?: string;
  arrow?: boolean;
  variant?: "outline";
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={`btn${variant ? ` ${variant}` : ""}${pending ? " busy" : ""}`} type="submit" disabled={pending} name={name} value={value}>
      {pending ? pendingLabel : children}
      {arrow && !pending && <ArrowIcon />}
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

export const OnFile = ({ name }: { name?: string }) => (name ? <Ticked>On file: {name}. Choose a new file only to replace it.</Ticked> : null);

export type Sample = { slot: string; name: string; what: string };

/** Demo Mode (docs/spec/11): the sample file the server sends when nothing is chosen. */
export function SampleTile({ sample }: { sample: Sample }) {
  return (
    <figure className="sample-tile" style={{ display: "flex", gap: 12, alignItems: "center", margin: 0 }}>
      <img src={`/apply/demo-sample/${sample.slot}`} alt={`Sample ${sample.what}`} width={112} height={80} style={{ objectFit: "contain", background: "#FFFFFF", borderRadius: 6, border: "1px solid #D4D4D4" }} />
      <figcaption><Ticked>Demo Mode attached a sample {sample.what} ({sample.name}). Choose a file only to replace it.</Ticked></figcaption>
    </figure>
  );
}

/** Drop zone around a native file input (boards A04/A05/A08). */
export function Dropzone({ name, label, hint, accept, multiple, capture, onFile, state, icon, sample }: {
  name: string;
  label: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  capture?: "user";
  onFile?: string;
  state: FormState;
  icon?: boolean;
  /** Demo Mode: shown when nothing is on file and nothing is chosen. */
  sample?: Sample;
}) {
  const errors = state.fieldErrors?.[name];
  return (
    <div className="field" data-invalid={errors?.length ? "" : undefined}>
      <div className="dropzone">
        {icon && <UploadIcon />}
        <label htmlFor={name} style={{ fontSize: 15, fontWeight: 500 }}>{label}</label>
        <span className="hint">{hint}</span>
        <input id={name} name={name} type="file" accept={accept} multiple={multiple} capture={capture} />
        <OnFile name={onFile} />
        {sample && !onFile && <SampleTile sample={sample} />}
      </div>
      {errors?.map((e) => <span key={e} className="error" role="alert">{e}</span>)}
    </div>
  );
}

