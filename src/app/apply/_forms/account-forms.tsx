"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, Submit } from "@/components/form";
import { createAccountAction, resendOtpAction, signInAction, verifyOtpAction } from "../actions";
import { initialState } from "../form-state";

// 2.1.1 (docs/design/Main.dc.html)
export function CreateAccountForm() {
  const [state, action] = useActionState(createAccountAction, initialState);
  const persona = state.values?.persona ?? "individual";
  return (
    <form action={action} noValidate className="stack-lg">
      <FormMessage state={state} />
      <fieldset className="field" data-invalid={state.fieldErrors?.persona ? "" : undefined}>
        <legend>I am opening an account as</legend>
        <div className="cards" key={persona}>
          <label className="choice-card">
            <input type="radio" name="persona" value="individual" defaultChecked={persona === "individual"} /> Individual
          </label>
          <label className="choice-card">
            <input type="radio" name="persona" value="company" defaultChecked={persona === "company"} /> Company
          </label>
        </div>
        {state.fieldErrors?.persona?.map((e) => <span key={e} className="error" role="alert">{e}</span>)}
      </fieldset>
      <div className="stack" style={{ gap: 20 }}>
        <div className="row">
          <Field name="firstName" label="First name" state={state}>
            <input id="firstName" name="firstName" autoComplete="given-name" defaultValue={state.values?.firstName} />
          </Field>
          <Field name="lastName" label="Last name" state={state}>
            <input id="lastName" name="lastName" autoComplete="family-name" defaultValue={state.values?.lastName} />
          </Field>
        </div>
        <Field name="email" label="Email address" state={state}>
          <input id="email" name="email" type="email" autoComplete="email" defaultValue={state.values?.email} aria-describedby="email-hint" />
          <span className="hint" id="email-hint">We will send a one-time code to this address.</span>
        </Field>
      </div>
      <p className="hint divider" style={{ paddingTop: 20, lineHeight: 1.6 }}>
        Opening for a company? Choose Company and enter the details of the person who will manage the account. Company documents are added in the next steps.
      </p>
      <p className="banner"><strong>Illustrative demo.</strong> Use made-up details and the SAMPLE documents only, never real personal data.</p>
      <div className="actions">
        <Submit pending="Creating…">Continue</Submit>
        <Link href="/apply/continue" className="link">I already started, resume</Link>
      </div>
    </form>
  );
}

export function SignInForm() {
  const [state, action] = useActionState(signInAction, initialState);
  return (
    <form action={action} noValidate className="stack-lg">
      <FormMessage state={state} />
      <Field name="email" label="Email address" state={state}>
        <input id="email" name="email" type="email" autoComplete="email" defaultValue={state.values?.email} />
      </Field>
      <div className="actions">
        <Submit pending="Sending…">Send me a code</Submit>
        <Link href="/apply" className="link">New here? Create an account</Link>
      </div>
    </form>
  );
}

// 2.1.2 (docs/design/A02-Verify-Email.dc.html). One input keeps the existing `code` field; it is
// styled as the board's digit boxes and accepts a pasted code.
export function VerifyForm({ length }: { length: number }) {
  const [state, action] = useActionState(verifyOtpAction, initialState);
  const [resendState, resend] = useActionState(resendOtpAction, initialState);
  return (
    <div className="stack-lg">
      <form action={action} noValidate className="stack-lg" id="verify-form">
        <FormMessage state={state} />
        <Field name="code" label={`${length === 6 ? "Six" : length}-digit code`} state={state}>
          <input id="code" name="code" className="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={length} />
        </Field>
        <p className="banner"><strong>Demo only.</strong> No email is sent. The code appears in the Terminal window that is running the app.</p>
        <div className="actions">
          <Submit pending="Checking…">Verify</Submit>
          <Link href="/apply/continue" className="link">Use a different email</Link>
        </div>
      </form>
      <form action={resend} className="stack" style={{ gap: 12 }}>
        <div><button className="link-btn" type="submit">Send a new code</button></div>
        <FormMessage state={resendState} />
      </form>
    </div>
  );
}
