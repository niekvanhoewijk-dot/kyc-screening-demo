"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import { Dropzone, Field, FormMessage, OnFile, Submit, v } from "@/components/form";
import { Ticked } from "@/components/icons";
import { eddAction, identityAction, questionnaireAction, residenceAction, submitAction } from "../actions";
import { initialState, type FormState } from "../form-state";

// Applicant step forms, ported to docs/design boards A04-A08. Field names, values and server
// actions are unchanged; only the presentation follows the boards.

type Option = { id: string; label: string };
type Country = { code: string; name: string };
type Saved = Record<string, unknown> | null;

const Select = ({ name, options, value, placeholder = "Choose…", describedBy }: { name: string; options: Option[]; value: string; placeholder?: string; describedBy?: string }) => (
  <select id={name} name={name} defaultValue={value} key={value} aria-describedby={describedBy}>
    <option value="">{placeholder}</option>
    {options.map((o) => (
      <option key={o.id} value={o.id}>{o.label}</option>
    ))}
  </select>
);

const countryOptions = (countries: Country[]) => countries.map((c) => ({ id: c.code, label: c.name }));


/** Continue + Back + Finish later (boards A04-A06). Completed steps are saved on the server. */
function StepActions({ children, back }: { children: ReactNode; back?: string }) {
  return (
    <div className="actions">
      {children}
      {back && <Link href={back} className="link">Back</Link>}
      <Link href="/" className="link" title="Your completed steps are saved. Sign in with your email to continue.">Finish later</Link>
    </div>
  );
}

const YesNo = ({ name, label, hint, state, saved }: { name: string; label: string; hint?: string; state: FormState; saved: Saved }) => {
  const typed = state.values?.[name];
  const value = typed ?? (saved?.[name] === true ? "yes" : saved?.[name] === false ? "no" : "");
  return (
    <fieldset className="field" data-invalid={state.fieldErrors?.[name] ? "" : undefined} key={value}>
      <legend style={{ fontSize: 14, lineHeight: 1.5, marginBottom: hint ? 6 : 12 }}>{label}</legend>
      {hint && <span className="hint" style={{ marginBottom: 6 }}>{hint}</span>}
      <div className="choices">
        <label className="choice"><input type="radio" name={name} value="yes" defaultChecked={value === "yes"} /> Yes</label>
        <label className="choice"><input type="radio" name={name} value="no" defaultChecked={value === "no"} /> No</label>
      </div>
      {state.fieldErrors?.[name]?.map((e) => <span key={e} className="error" role="alert">{e}</span>)}
    </fieldset>
  );
};

// 2.1.4 (A04-Proof-Of-Identity)
export function IdentityForm(props: {
  docTypes: (Option & { needs_back: boolean })[];
  countries: Country[];
  saved: Saved;
  onFile: { front?: string; back?: string; selfie?: string };
  documentAccept: string;
  selfieAccept: string;
  selfieRetry: boolean;
  back?: string;
}) {
  const [state, action] = useActionState(identityAction, initialState);
  const noExpiry = state.values ? state.values.noExpiry === "on" : props.saved?.noExpiry === true;
  const docType = v(state, props.saved, "docType");
  const needsBack = props.docTypes.filter((d) => d.needs_back).map((d) => d.label).join(" or ");
  return (
    <form action={action} noValidate className="stack-lg">
      {props.selfieRetry && !state.message && (
        <div className="banner error" role="alert">We couldn&apos;t verify your last selfie. Please take a new one.</div>
      )}
      <FormMessage state={state} />
      <fieldset className="field" data-invalid={state.fieldErrors?.docType ? "" : undefined}>
        <legend>Document type</legend>
        {/* Sends "" when no card is picked, like the old select, so validation messages stay the same. */}
        <input type="hidden" name="docType" value="" />
        <div className="cards" key={docType}>
          {props.docTypes.map((d) => (
            <label key={d.id} className="choice-card">
              <input type="radio" name="docType" value={d.id} defaultChecked={docType === d.id} /> {d.label}
            </label>
          ))}
        </div>
        {state.fieldErrors?.docType?.map((e) => <span key={e} className="error" role="alert">{e}</span>)}
      </fieldset>

      <div className="row">
        <Field name="issuingCountry" label="Issuing country" state={state}>
          <Select name="issuingCountry" options={countryOptions(props.countries)} value={v(state, props.saved, "issuingCountry")} />
        </Field>
        <Field name="expiryDate" label="Expiry date" state={state}>
          <input id="expiryDate" name="expiryDate" type="date" defaultValue={v(state, props.saved, "expiryDate")} />
        </Field>
      </div>

      <div className="stack" style={{ gap: 14 }}>
        <span className="label">Photo of your document</span>
        <Dropzone name="front" label="Front of the document: drop your photo here or choose a file" hint="JPG, PNG or PDF, up to 10 MB. All four corners visible." accept={props.documentAccept} onFile={props.onFile.front} state={state} icon />
        <Dropzone name="back" label="Back of the document" hint={`Needed for ${needsBack}.`} accept={props.documentAccept} onFile={props.onFile.back} state={state} />
        <div className="cols">
          <div>
            <h3 className="mini-head">A good photo</h3>
            <ul className="bullets">
              <li>All four corners are visible</li>
              <li>Text is sharp and readable</li>
              <li>The document is valid, not expired</li>
            </ul>
          </div>
          <div>
            <h3 className="mini-head">We cannot accept</h3>
            <ul className="bullets">
              <li>Edited, damaged or unclear documents</li>
              <li>Photos with watermarks of any kind</li>
              <li>Expired documents</li>
            </ul>
          </div>
        </div>
        <label className="choice" style={{ fontSize: 14 }}>
          <input type="checkbox" name="noExpiry" defaultChecked={noExpiry} key={String(noExpiry)} /> My document has no expiration date
        </label>
      </div>

      <div className="panel-soft field" data-invalid={state.fieldErrors?.selfie ? "" : undefined}>
        <h2 className="section-title">Take a selfie</h2>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: "#262626" }}>
          Look straight at the camera in good light, no hat or sunglasses. Our verification partner compares your face with the photo on your document.
        </p>
        <label htmlFor="selfie" className="label">Selfie</label>
        <input id="selfie" name="selfie" type="file" accept={props.selfieAccept} capture="user" />
        {props.onFile.selfie ? <OnFile name={props.onFile.selfie} /> : <span className="hint">Not taken yet</span>}
        {state.fieldErrors?.selfie?.map((e) => <span key={e} className="error" role="alert">{e}</span>)}
      </div>

      <StepActions back={props.back}><Submit pending="Uploading…">Continue</Submit></StepActions>
    </form>
  );
}

// 2.1.5 (A05-Proof-Of-Residence)
export function ResidenceForm(props: {
  porTypes: Option[];
  countries: Country[];
  saved: Saved;
  onFile?: string;
  documentAccept: string;
  maxAgeMonths: number;
  back?: string;
}) {
  const [state, action] = useActionState(residenceAction, initialState);
  const text = (name: string, label: string, opts: { optional?: boolean; autoComplete?: string; type?: string; placeholder?: string } = {}) => (
    <Field name={name} label={label} optional={opts.optional} state={state}>
      <input id={name} name={name} type={opts.type ?? "text"} autoComplete={opts.autoComplete} placeholder={opts.placeholder} defaultValue={v(state, props.saved, name)} />
    </Field>
  );
  return (
    <form action={action} noValidate className="stack-lg">
      <FormMessage state={state} />
      <section className="stack" style={{ gap: 20 }}>
        <h2 className="section-title">Residential address</h2>
        <div className="row">
          {text("apartment", "Apartment, flat or suite", { optional: true })}
          {text("addressLine1", "Address line 1", { autoComplete: "address-line1" })}
        </div>
        <div className="row">
          {text("addressLine2", "Address line 2", { optional: true, autoComplete: "address-line2" })}
          {text("city", "City, town or village", { autoComplete: "address-level2" })}
        </div>
        <div className="row three">
          {text("region", "County or region", { autoComplete: "address-level1" })}
          {text("postcode", "Postcode", { optional: true, autoComplete: "postal-code" })}
          <Field name="country" label="Country" state={state}>
            <Select name="country" options={countryOptions(props.countries)} value={v(state, props.saved, "country")} />
          </Field>
        </div>
        <div className="row">
          {text("mobilePhone", "Mobile phone", { optional: true, type: "tel", autoComplete: "tel", placeholder: "+31 6 1234 5678" })}
          {text("landlinePhone", "Landline", { optional: true, type: "tel", placeholder: "With country code" })}
        </div>
      </section>

      <section className="stack divider">
        <h2 className="section-title">One document, issued in the last {props.maxAgeMonths} months</h2>
        <div className="cols">
          <div style={{ flexBasis: 280 }}>
            <h3 className="mini-head">Accepted</h3>
            <ul className="bullets">{props.porTypes.map((t) => <li key={t.id}>{t.label}</li>)}</ul>
          </div>
          <div style={{ flexBasis: 220 }}>
            <h3 className="mini-head">Not accepted</h3>
            <ul className="bullets">
              <li>Photos of envelopes or parcels</li>
              <li>Mobile phone bills</li>
              <li>P.O. box addresses</li>
            </ul>
            <p className="hint" style={{ marginTop: 14 }}>A bill in joint names is fine if the other person also completes verification.</p>
          </div>
        </div>
        <Field name="porType" label="Document type" state={state}>
          <Select name="porType" options={props.porTypes} value={v(state, props.saved, "porType")} />
        </Field>
        <Dropzone name="por" label="Choose your document" hint="JPG, PNG or PDF, up to 10 MB. All four corners visible. Bank statements may hide transactions, but issuer, name, address and date must stay visible." accept={props.documentAccept} onFile={props.onFile} state={state} />
      </section>

      <StepActions back={props.back}><Submit pending="Uploading…">Continue</Submit></StepActions>
    </form>
  );
}

// 2.1.6 (A06-Questionnaire)
export function QuestionnaireForm(props: {
  saved: Saved;
  email: string;
  address: string;
  countries: Country[];
  languages: Option[];
  /** Attested by the ID wallet: shown read-only; the server ignores any other posted value (O-76). */
  locked?: { birthDate: string; nationalities: string[] } | null;
  factors: Record<"deposit_12m" | "source_of_funds" | "employment_status" | "occupation_industry" | "annual_income" | "net_worth", Option[]>;
  back?: string;
}) {
  const [state, action] = useActionState(questionnaireAction, initialState);
  const f = props.factors;
  const select = (name: keyof typeof f | "nationality" | "preferredLanguage", label: string, options: Option[], hint?: string) => (
    <Field name={name} label={label} hint={hint} state={state}>
      <Select name={name} options={options} value={v(state, props.saved, name)} />
    </Field>
  );
  const checked = (name: string) => (state.values ? state.values[name] === "on" : props.saved?.[name] === true);
  return (
    <form action={action} noValidate className="stack-lg" style={{ gap: 40 }}>
      <FormMessage state={state} />
      <section className="stack" style={{ gap: 20 }}>
        <h2 className="section-title">About you</h2>
        <div className="row">
          {props.locked ? (
            <div className="field">
              <span className="label">Date of birth</span>
              <div className="readonly"><span>{props.locked.birthDate}</span><Ticked>From your ID wallet</Ticked></div>
              <input type="hidden" name="dateOfBirth" value={props.locked.birthDate} />
            </div>
          ) : (
            <Field name="dateOfBirth" label="Date of birth" state={state}>
              <input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={v(state, props.saved, "dateOfBirth")} aria-describedby="dob-hint" />
              <span className="hint" id="dob-hint">Must match the date on your ID.</span>
            </Field>
          )}
          {props.locked && props.locked.nationalities.length === 1 ? (
            <div className="field">
              <span className="label">Nationality</span>
              <div className="readonly"><span>{props.countries.find((c) => c.code === props.locked!.nationalities[0])?.name}</span><Ticked>From your ID wallet</Ticked></div>
              <input type="hidden" name="nationality" value={props.locked.nationalities[0]} />
            </div>
          ) : (
            select("nationality", "Nationality", countryOptions(props.locked ? props.countries.filter((c) => props.locked!.nationalities.includes(c.code)) : props.countries))
          )}
        </div>
        <div className="row">
          {select("preferredLanguage", "Preferred language", props.languages)}
          <Field name="phone" label="Phone number with country code" state={state}>
            <input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={v(state, props.saved, "phone")} />
          </Field>
        </div>
        <div className="field">
          <span className="label">Email address</span>
          <div className="readonly"><span>{props.email}</span><Ticked>Verified</Ticked></div>
        </div>
        <div className="field">
          <span className="label">Address</span>
          <div className="readonly"><span>{props.address}</span><span className="muted">From the previous step</span></div>
        </div>
        <Field name="tin" label="Tax identification number (TIN)" state={state}>
          <input id="tin" name="tin" defaultValue={v(state, props.saved, "tin")} />
        </Field>
        <Field name="tinMissingReason" label="If you do not have one, tell us why" hint="For example: income too low, or your country issues TINs only to companies." state={state}>
          <input id="tinMissingReason" name="tinMissingReason" defaultValue={v(state, props.saved, "tinMissingReason")} />
        </Field>
      </section>

      <section className="stack divider" style={{ gap: 24 }}>
        <h2 className="section-title">Tax and public roles</h2>
        <YesNo name="usTaxResident" label="Are you a United States resident for tax purposes?" state={state} saved={props.saved} />
        <YesNo
          name="pep"
          label="Are you currently, or have you previously been, a politically exposed person (PEP)?"
          hint="Someone who holds or held a prominent public function, or a close family member or associate of such a person."
          state={state}
          saved={props.saved}
        />
      </section>

      <section className="stack divider" style={{ gap: 20 }}>
        <h2 className="section-title">Your finances</h2>
        {select("deposit_12m", "Expected deposits in the next 12 months", f.deposit_12m)}
        {select("source_of_funds", "Main source of funds", f.source_of_funds)}
        <label className="choice" style={{ fontSize: 14 }}>
          <input type="checkbox" name="onlySourceOfWealth" defaultChecked={checked("onlySourceOfWealth")} key={String(checked("onlySourceOfWealth"))} />
          This is my only source of wealth
        </label>
        {select("employment_status", "Employment status", f.employment_status)}
        <div className="row">
          {select("occupation_industry", "Industry of occupation", f.occupation_industry)}
          <Field name="occupationDetail" label="Industry details (if Other)" state={state}>
            <input id="occupationDetail" name="occupationDetail" defaultValue={v(state, props.saved, "occupationDetail")} />
          </Field>
        </div>
        {select("annual_income", "Total estimated annual income", f.annual_income)}
        {select("net_worth", "Estimated net worth", f.net_worth)}
      </section>

      <section className="stack divider">
        <Field name="declaration" label="" state={state}>
          <label className="choice top">
            <input type="checkbox" name="declaration" defaultChecked={checked("declaration")} key={String(checked("declaration"))} />
            <span>
              I declare that I have carefully read, accept and fully understood the risk disclosure and the terms and conditions. I understand that every investment involves risk.
            </span>
          </label>
        </Field>
      </section>

      <StepActions back={props.back}><Submit>Continue</Submit></StepActions>
    </form>
  );
}

// 2.1.7 before submission (no board; A07 frame)
export function SubmitForm() {
  const [state, action] = useActionState(submitAction, initialState);
  return (
    <form action={action} className="stack">
      <FormMessage state={state} />
      <div className="actions"><Submit pending="Submitting…">Submit for review</Submit></div>
    </form>
  );
}

// EDD request (A08-EDD-Request). Neutral wording: never says why (D7).
export function EddForm({ extraKyc, documentAccept, selfieAccept }: { extraKyc: "required" | "already_satisfied"; documentAccept: string; selfieAccept: string }) {
  const [state, action] = useActionState(eddAction, initialState);
  return (
    <form action={action} noValidate className="stack-lg">
      <FormMessage state={state} />
      <ol className="numbered compact">
        <li>
          <span className="num">1</span>
          <div className="stack" style={{ gap: 10, flex: "1 1 auto", minWidth: 0 }}>
            <h2 style={{ fontSize: 19 }}>Proof of source of funds</h2>
            <p>A document that shows where the money you deposit comes from, for example a recent tax report, payslips, a sale contract or a statement of the account it comes from.</p>
            <Dropzone name="sof" label="Choose one or more documents" hint="JPG, PNG or PDF, up to 10 MB each." accept={documentAccept} multiple state={state} />
            <Field name="note" label="Anything we should know?" optional state={state}>
              <textarea id="note" name="note" rows={3} defaultValue={state.values?.note} />
            </Field>
          </div>
        </li>
        <li>
          <span className="num">2</span>
          <div className="stack" style={{ gap: 10, flex: "1 1 auto", minWidth: 0 }}>
            <h2 style={{ fontSize: 19 }}>Extra identity confirmation</h2>
            {extraKyc === "required" ? (
              <Dropzone name="eddKyc" label="Photo of you holding your identity document" hint="Your face and the document both clearly visible." accept={selfieAccept} capture="user" state={state} />
            ) : (
              <>
                <p>Already done. The selfie you took earlier covers this, so there is nothing more to upload.</p>
                <Ticked>Completed</Ticked>
              </>
            )}
          </div>
        </li>
      </ol>
      <div className="actions"><Submit pending="Uploading…">Send to review</Submit></div>
    </form>
  );
}
