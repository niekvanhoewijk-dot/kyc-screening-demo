"use client";

import { useActionState } from "react";
import { Field, FormMessage, Submit, v } from "@/components/form";
import { companyAction, companyDocumentsAction, confirmPersonsAction, personAction } from "../actions";
import { initialState } from "../form-state";

type Option = { id: string; label: string };
type Country = { code: string; name: string };
type Saved = Record<string, unknown> | null;

const Select = ({ name, options, value }: { name: string; options: Option[]; value: string }) => (
  <select id={name} name={name} defaultValue={value} key={value}>
    <option value="">Choose…</option>
    {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
  </select>
);
const countryOptions = (cs: Country[]) => cs.map((c) => ({ id: c.code, label: c.name }));

export function CompanyForm(props: { saved: Saved; countries: Country[]; industries: Option[]; deposits: Option[]; sources: Option[] }) {
  const [state, action] = useActionState(companyAction, initialState);
  const text = (name: string, label: string, hint?: string) => (
    <Field name={name} label={label} hint={hint} state={state}>
      <input id={name} name={name} defaultValue={v(state, props.saved, name)} />
    </Field>
  );
  const declared = state.values ? state.values.declaration === "on" : props.saved?.declaration === true;
  return (
    <form action={action} noValidate>
      <FormMessage state={state} />
      {text("legalName", "Legal name")}
      <div className="row">
        {text("registrationNumber", "Registration number")}
        <Field name="countryOfIncorporation" label="Country of incorporation" state={state}>
          <Select name="countryOfIncorporation" options={countryOptions(props.countries)} value={v(state, props.saved, "countryOfIncorporation")} />
        </Field>
      </div>
      <h2 className="section-title">Registered address</h2>
      {text("addressLine1", "Address")}
      <div className="row">
        {text("city", "City")}
        {text("postcode", "Postcode (optional)")}
      </div>
      <Field name="addressCountry" label="Country" state={state}>
        <Select name="addressCountry" options={countryOptions(props.countries)} value={v(state, props.saved, "addressCountry")} />
      </Field>
      <h2 className="section-title">About the business</h2>
      <div className="row">
        <Field name="industry" label="Industry" state={state}><Select name="industry" options={props.industries} value={v(state, props.saved, "industry")} /></Field>
        {text("industryDetail", "Industry details (if Other)")}
      </div>
      <div className="row">
        <Field name="deposit_12m" label="Expected deposits in the next 12 months" state={state}><Select name="deposit_12m" options={props.deposits} value={v(state, props.saved, "deposit_12m")} /></Field>
        <Field name="source_of_funds" label="Main source of funds" state={state}><Select name="source_of_funds" options={props.sources} value={v(state, props.saved, "source_of_funds")} /></Field>
      </div>
      <Field name="declaration" label="" state={state}>
        <label className="choice">
          <input type="checkbox" name="declaration" defaultChecked={declared} key={String(declared)} />
          I am authorised to act for this company, and I declare that I have read, accept and fully understood the risk disclosure and the terms and conditions.
        </label>
      </Field>
      <div className="actions"><Submit>Save and continue</Submit></div>
    </form>
  );
}

export function PersonForm(props: {
  saved: Saved;
  personId?: string;
  isApplicant: boolean;
  countries: Country[];
  roles: Option[];
  onFile: { poi?: string; por?: string };
  documentAccept: string;
}) {
  const [state, action] = useActionState(personAction, initialState);
  const savedRoles = (props.saved?.roles as string[] | undefined) ?? (props.isApplicant ? ["representative"] : []);
  const pep = state.values?.pep ?? (props.saved?.pep === true ? "yes" : props.saved?.pep === false ? "no" : "");
  return (
    <form action={action} noValidate>
      <FormMessage state={state} />
      {props.personId && <input type="hidden" name="personId" value={props.personId} />}
      <input type="hidden" name="isApplicant" value={String(props.isApplicant)} />
      <Field name="fullName" label="Full name (as on the ID)" state={state}>
        <input id="fullName" name="fullName" defaultValue={v(state, props.saved, "fullName")} />
      </Field>
      <div className="row">
        <Field name="dateOfBirth" label="Date of birth" state={state}>
          <input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={v(state, props.saved, "dateOfBirth")} />
        </Field>
        <Field name="nationality" label="Nationality" state={state}>
          <Select name="nationality" options={countryOptions(props.countries)} value={v(state, props.saved, "nationality")} />
        </Field>
      </div>
      <Field name="countryOfResidence" label="Country of residence" state={state}>
        <Select name="countryOfResidence" options={countryOptions(props.countries)} value={v(state, props.saved, "countryOfResidence")} />
      </Field>
      <fieldset className="field" data-invalid={state.fieldErrors?.roles ? "" : undefined}>
        <legend>Roles</legend>
        {props.roles.map((r) => (
          <label key={r.id} className="choice">
            <input type="checkbox" name="roles" value={r.id} defaultChecked={savedRoles.includes(r.id)} /> {r.label}
          </label>
        ))}
        {state.fieldErrors?.roles?.map((e) => <span key={e} className="error" role="alert">{e}</span>)}
      </fieldset>
      <Field name="sharePercent" label="Shareholding % (shareholders only)" state={state}>
        <input id="sharePercent" name="sharePercent" inputMode="decimal" defaultValue={v(state, props.saved, "sharePercent")} />
      </Field>
      <fieldset className="field" data-invalid={state.fieldErrors?.pep ? "" : undefined} key={pep}>
        <legend>Is this person, or have they been, a politically exposed person (PEP)?</legend>
        <label className="choice"><input type="radio" name="pep" value="yes" defaultChecked={pep === "yes"} /> Yes</label>
        <label className="choice"><input type="radio" name="pep" value="no" defaultChecked={pep === "no"} /> No</label>
        {state.fieldErrors?.pep?.map((e) => <span key={e} className="error" role="alert">{e}</span>)}
      </fieldset>
      {props.isApplicant ? (
        <p className="muted">Your own ID, selfie and proof of residence come in the next steps.</p>
      ) : (
        <>
          <Field name="poi" label="Passport, ID card or driving licence" hint="Valid, all four corners visible." state={state}>
            <input id="poi" name="poi" type="file" accept={props.documentAccept} />
            {props.onFile.poi && <span className="on-file">On file: {props.onFile.poi}</span>}
          </Field>
          <Field name="por" label="Proof of residence" hint="Issued in the last 3 months." state={state}>
            <input id="por" name="por" type="file" accept={props.documentAccept} />
            {props.onFile.por && <span className="on-file">On file: {props.onFile.por}</span>}
          </Field>
        </>
      )}
      <div className="actions"><Submit>{props.personId ? "Save changes" : props.isApplicant ? "Save" : "Add person"}</Submit></div>
    </form>
  );
}

export function ConfirmPersonsForm() {
  const [state, action] = useActionState(confirmPersonsAction, initialState);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <div className="actions"><Submit>Everyone is listed, continue</Submit></div>
    </form>
  );
}

export function CompanyDocumentsForm(props: { items: { id: string; item: number; label: string; uploaded: string[] }[]; unsorted: string[]; documentAccept: string }) {
  const [state, action] = useActionState(companyDocumentsAction, initialState);
  return (
    <form action={action} noValidate>
      <FormMessage state={state} />
      {props.items.map((i) => (
        <Field key={i.id} name={`doc_${i.id}`} label={`${i.item}. ${i.label}`} state={state}>
          <input id={`doc_${i.id}`} name={`doc_${i.id}`} type="file" multiple accept={props.documentAccept} />
          {i.uploaded.length > 0 && <span className="on-file">On file: {i.uploaded.join(", ")}</span>}
        </Field>
      ))}
      <Field name="doc_unsorted" label="Other documents" hint="Not sure where a document belongs? Upload it here." state={state}>
        <input id="doc_unsorted" name="doc_unsorted" type="file" multiple accept={props.documentAccept} />
        {props.unsorted.length > 0 && <span className="on-file">On file: {props.unsorted.join(", ")}</span>}
      </Field>
      <div className="actions">
        <button className="btn secondary" type="submit" name="intent" value="upload">Upload</button>
        <button className="btn" type="submit" name="intent" value="finish">Upload and continue</button>
      </div>
    </form>
  );
}
