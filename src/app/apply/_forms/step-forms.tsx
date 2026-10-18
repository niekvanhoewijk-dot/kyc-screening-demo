"use client";

import { useActionState } from "react";
import { Field, FormMessage, Submit, v } from "@/components/form";
import { eddAction, identityAction, questionnaireAction, residenceAction, submitAction } from "../actions";
import { initialState, type FormState } from "../form-state";

type Option = { id: string; label: string };
type Country = { code: string; name: string };
type Saved = Record<string, unknown> | null;

const Select = ({ name, options, value, placeholder = "Choose…" }: { name: string; options: Option[]; value: string; placeholder?: string }) => (
  <select id={name} name={name} defaultValue={value} key={value}>
    <option value="">{placeholder}</option>
    {options.map((o) => (
      <option key={o.id} value={o.id}>{o.label}</option>
    ))}
  </select>
);

const countryOptions = (countries: Country[]) => countries.map((c) => ({ id: c.code, label: c.name }));

const OnFile = ({ name }: { name?: string }) =>
  name ? <span className="on-file">On file: {name}. Choose a new file only to replace it.</span> : null;

const YesNo = ({ name, label, state, saved }: { name: string; label: string; state: FormState; saved: Saved }) => {
  const typed = state.values?.[name];
  const value = typed ?? (saved?.[name] === true ? "yes" : saved?.[name] === false ? "no" : "");
  return (
    <fieldset className="field" data-invalid={state.fieldErrors?.[name] ? "" : undefined} key={value}>
      <legend>{label}</legend>
      <label className="choice"><input type="radio" name={name} value="yes" defaultChecked={value === "yes"} /> Yes</label>
      <label className="choice"><input type="radio" name={name} value="no" defaultChecked={value === "no"} /> No</label>
      {state.fieldErrors?.[name]?.map((e) => <span key={e} className="error" role="alert">{e}</span>)}
    </fieldset>
  );
};

// 2.1.4
export function IdentityForm(props: {
  docTypes: (Option & { needs_back: boolean })[];
  countries: Country[];
  saved: Saved;
  onFile: { front?: string; back?: string; selfie?: string };
  documentAccept: string;
  selfieAccept: string;
  selfieRetry: boolean;
}) {
  const [state, action] = useActionState(identityAction, initialState);
  const noExpiry = state.values ? state.values.noExpiry === "on" : props.saved?.noExpiry === true;
  return (
    <form action={action} noValidate>
      {props.selfieRetry && !state.message && (
        <div className="banner error" role="alert">We couldn't verify your last selfie. Please take a new one.</div>
      )}
      <FormMessage state={state} />
      <div className="row">
        <Field name="docType" label="Document type" state={state}>
          <Select name="docType" options={props.docTypes} value={v(state, props.saved, "docType")} />
        </Field>
        <Field name="issuingCountry" label="Issuing country" state={state}>
          <Select name="issuingCountry" options={countryOptions(props.countries)} value={v(state, props.saved, "issuingCountry")} />
        </Field>
      </div>
      <Field name="expiryDate" label="Expiry date" state={state}>
        <input id="expiryDate" name="expiryDate" type="date" defaultValue={v(state, props.saved, "expiryDate")} />
        <label className="choice" style={{ marginTop: 6 }}>
          <input type="checkbox" name="noExpiry" defaultChecked={noExpiry} key={String(noExpiry)} /> My document has no expiration date
        </label>
      </Field>
      <Field name="front" label="Front of the document" hint="Photo or scan, all four corners visible." state={state}>
        <input id="front" name="front" type="file" accept={props.documentAccept} />
        <OnFile name={props.onFile.front} />
      </Field>
      <Field name="back" label="Back of the document" hint={`Needed for: ${props.docTypes.filter((d) => d.needs_back).map((d) => d.label).join(", ")}.`} state={state}>
        <input id="back" name="back" type="file" accept={props.documentAccept} />
        <OnFile name={props.onFile.back} />
      </Field>
      <Field name="selfie" label="Selfie" hint="Good light, face the camera, no hat or sunglasses. Checked by our identity verification partner." state={state}>
        <input id="selfie" name="selfie" type="file" accept={props.selfieAccept} capture="user" />
        <OnFile name={props.onFile.selfie} />
      </Field>
      <div className="actions"><Submit pending="Uploading…">Save and continue</Submit></div>
    </form>
  );
}

// 2.1.5
export function ResidenceForm(props: { porTypes: Option[]; countries: Country[]; saved: Saved; onFile?: string; documentAccept: string; maxAgeMonths: number }) {
  const [state, action] = useActionState(residenceAction, initialState);
  const text = (name: string, label: string, opts: { hint?: string; autoComplete?: string; type?: string } = {}) => (
    <Field name={name} label={label} hint={opts.hint} state={state}>
      <input id={name} name={name} type={opts.type ?? "text"} autoComplete={opts.autoComplete} defaultValue={v(state, props.saved, name)} />
    </Field>
  );
  return (
    <form action={action} noValidate>
      <FormMessage state={state} />
      {text("apartment", "Apartment, flat or suite (optional)")}
      {text("addressLine1", "Address line 1", { autoComplete: "address-line1" })}
      {text("addressLine2", "Address line 2 (optional)", { autoComplete: "address-line2" })}
      <div className="row">
        {text("city", "City, town or village", { autoComplete: "address-level2" })}
        {text("region", "County or region", { autoComplete: "address-level1" })}
      </div>
      <div className="row">
        <Field name="country" label="Country" state={state}>
          <Select name="country" options={countryOptions(props.countries)} value={v(state, props.saved, "country")} />
        </Field>
        {text("postcode", "Postcode (optional)", { autoComplete: "postal-code" })}
      </div>
      <div className="row">
        {text("mobilePhone", "Mobile number (optional)", { type: "tel", autoComplete: "tel", hint: "With country code, e.g. +31 6 1234 5678" })}
        {text("landlinePhone", "Landline (optional)", { type: "tel" })}
      </div>
      <h2 className="section-title">Proof of residence</h2>
      <Field name="porType" label="Document type" hint={`One document, issued in the last ${props.maxAgeMonths} months, showing this address.`} state={state}>
        <Select name="porType" options={props.porTypes} value={v(state, props.saved, "porType")} />
      </Field>
      <Field name="por" label="Upload the document" hint="All four corners visible. Bank statements may cover transactions, but issuer, name, address and date must be visible." state={state}>
        <input id="por" name="por" type="file" accept={props.documentAccept} />
        <OnFile name={props.onFile} />
      </Field>
      <div className="actions"><Submit pending="Uploading…">Save and continue</Submit></div>
    </form>
  );
}

// 2.1.6
export function QuestionnaireForm(props: {
  saved: Saved;
  email: string;
  address: string;
  countries: Country[];
  languages: Option[];
  factors: Record<"deposit_12m" | "source_of_funds" | "employment_status" | "occupation_industry" | "annual_income" | "net_worth", Option[]>;
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
    <form action={action} noValidate>
      <FormMessage state={state} />
      <h2 className="section-title" style={{ borderTop: 0, paddingTop: 0, marginTop: 0 }}>About you</h2>
      <div className="row">
        <Field name="dateOfBirth" label="Date of birth" hint="As on your identity document." state={state}>
          <input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={v(state, props.saved, "dateOfBirth")} />
        </Field>
        {select("nationality", "Nationality", countryOptions(props.countries))}
      </div>
      <div className="row">
        {select("preferredLanguage", "Preferred language", props.languages)}
        <Field name="phone" label="Phone number" hint="With country code" state={state}>
          <input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={v(state, props.saved, "phone")} />
        </Field>
      </div>
      <div className="field">
        <label>Email</label>
        <span>{props.email} <span className="on-file">verified</span></span>
      </div>
      <div className="field">
        <label>Address</label>
        <span>{props.address} <span className="hint">(from the previous step)</span></span>
      </div>

      <h2 className="section-title">Tax</h2>
      <Field name="tin" label="Tax identification number (TIN)" state={state}>
        <input id="tin" name="tin" defaultValue={v(state, props.saved, "tin")} />
      </Field>
      <Field name="tinMissingReason" label="No TIN? Tell us briefly why" hint="For example: income too low, or your country issues TINs only to companies." state={state}>
        <input id="tinMissingReason" name="tinMissingReason" defaultValue={v(state, props.saved, "tinMissingReason")} />
      </Field>
      <YesNo name="usTaxResident" label="Are you a US tax resident?" state={state} saved={props.saved} />
      <YesNo name="pep" label="Are you, or have you ever been, a politically exposed person (PEP)?" state={state} saved={props.saved} />

      <h2 className="section-title">Your funds</h2>
      {select("deposit_12m", "Expected deposits in the next 12 months", f.deposit_12m)}
      {select("source_of_funds", "Main source of funds", f.source_of_funds)}
      <label className="choice field">
        <input type="checkbox" name="onlySourceOfWealth" defaultChecked={checked("onlySourceOfWealth")} key={String(checked("onlySourceOfWealth"))} />
        This is my only source of wealth
      </label>
      <div className="row">
        {select("employment_status", "Employment status", f.employment_status)}
        {select("occupation_industry", "Industry of occupation", f.occupation_industry)}
      </div>
      <Field name="occupationDetail" label="Industry details (if Other)" state={state}>
        <input id="occupationDetail" name="occupationDetail" defaultValue={v(state, props.saved, "occupationDetail")} />
      </Field>
      <div className="row">
        {select("annual_income", "Total estimated annual income", f.annual_income)}
        {select("net_worth", "Estimated net worth", f.net_worth)}
      </div>

      <h2 className="section-title">Declaration</h2>
      <Field name="declaration" label="" state={state}>
        <label className="choice">
          <input type="checkbox" name="declaration" defaultChecked={checked("declaration")} key={String(checked("declaration"))} />
          I declare that I have carefully read, accept, and fully understood the risk disclosure and the terms and conditions.
        </label>
      </Field>
      <div className="actions"><Submit>Save and continue</Submit></div>
    </form>
  );
}

// 2.1.7
export function SubmitForm() {
  const [state, action] = useActionState(submitAction, initialState);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <div className="actions"><Submit pending="Submitting…">Submit application</Submit></div>
    </form>
  );
}

// EDD request from the analyst (spec 05). Neutral wording: never says why (D7).
export function EddForm({ extraKyc, documentAccept, selfieAccept }: { extraKyc: "required" | "already_satisfied"; documentAccept: string; selfieAccept: string }) {
  const [state, action] = useActionState(eddAction, initialState);
  return (
    <form action={action} noValidate>
      <FormMessage state={state} />
      <Field name="sof" label="Proof of source of funds" hint="For example a tax report, payslips or a sale contract. You can select several files." state={state}>
        <input id="sof" name="sof" type="file" multiple accept={documentAccept} />
      </Field>
      {extraKyc === "required" ? (
        <Field name="eddKyc" label="Photo of you holding your identity document" hint="Your face and the document both clearly visible." state={state}>
          <input id="eddKyc" name="eddKyc" type="file" accept={selfieAccept} capture="user" />
        </Field>
      ) : (
        <p className="on-file">Extra identity check: already done with your selfie. Nothing more needed.</p>
      )}
      <Field name="note" label="Anything you'd like to add (optional)" state={state}>
        <input id="note" name="note" defaultValue={state.values?.note} />
      </Field>
      <div className="actions"><Submit pending="Uploading…">Send documents</Submit></div>
    </form>
  );
}
