"use client";

import { useActionState } from "react";
import { Field, FormMessage, Submit } from "@/components/form";
import { createAccountAction, resendOtpAction, signInAction, verifyOtpAction } from "../actions";
import { initialState } from "../form-state";

export function CreateAccountForm() {
  const [state, action] = useActionState(createAccountAction, initialState);
  const persona = state.values?.persona ?? "individual";
  return (
    <form action={action} noValidate>
      <FormMessage state={state} />
      <fieldset className="field">
        <legend>I am opening an account as</legend>
        <label className="choice">
          <input type="radio" name="persona" value="individual" defaultChecked={persona === "individual"} /> An individual
        </label>
        <label className="choice">
          <input type="radio" name="persona" value="company" defaultChecked={persona === "company"} /> A company
        </label>
        {state.fieldErrors?.persona?.map((e) => <span key={e} className="error">{e}</span>)}
      </fieldset>
      <div className="row">
        <Field name="firstName" label="First name" state={state}>
          <input id="firstName" name="firstName" autoComplete="given-name" defaultValue={state.values?.firstName} />
        </Field>
        <Field name="lastName" label="Last name" state={state}>
          <input id="lastName" name="lastName" autoComplete="family-name" defaultValue={state.values?.lastName} />
        </Field>
      </div>
      <Field name="email" label="Email" hint="We'll send you a code to confirm it." state={state}>
        <input id="email" name="email" type="email" autoComplete="email" defaultValue={state.values?.email} />
      </Field>
      <div className="actions">
        <Submit pending="Creating…">Create account</Submit>
      </div>
    </form>
  );
}

export function SignInForm() {
  const [state, action] = useActionState(signInAction, initialState);
  return (
    <form action={action} noValidate>
      <FormMessage state={state} />
      <Field name="email" label="Email" state={state}>
        <input id="email" name="email" type="email" autoComplete="email" defaultValue={state.values?.email} />
      </Field>
      <div className="actions">
        <Submit pending="Sending…">Send me a code</Submit>
      </div>
    </form>
  );
}

export function VerifyForm({ length }: { length: number }) {
  const [state, action] = useActionState(verifyOtpAction, initialState);
  const [resendState, resend] = useActionState(resendOtpAction, initialState);
  return (
    <>
      <form action={action} noValidate>
        <FormMessage state={state} />
        <Field name="code" label="Verification code" hint={`${length} digits`} state={state}>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={length} />
        </Field>
        <div className="actions">
          <Submit pending="Checking…">Verify</Submit>
        </div>
      </form>
      <form action={resend} style={{ marginTop: 20 }}>
        <FormMessage state={resendState} />
        <button className="btn secondary" type="submit">Send a new code</button>
      </form>
    </>
  );
}
