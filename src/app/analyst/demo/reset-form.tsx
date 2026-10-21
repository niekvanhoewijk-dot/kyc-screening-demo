"use client";

import { useActionState } from "react";
import { Field, FormMessage, Submit } from "@/components/form";
import { initialState } from "../../apply/form-state";
import { resetDemoAction } from "./actions";

export function ResetForm() {
  const [state, action] = useActionState(resetDemoAction, initialState);
  return (
    <form action={action} className="stack">
      <Field name="confirm" label="Type RESET to delete every case and reseed the personas" state={state}>
        <input id="confirm" name="confirm" autoComplete="off" style={{ maxWidth: 320 }} />
      </Field>
      <div><Submit pending="Resetting…" arrow={false}>Reset demo</Submit></div>
      <FormMessage state={state} />
    </form>
  );
}
