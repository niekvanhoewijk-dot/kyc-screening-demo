"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Dropzone, Field, FormMessage, OnFile, Submit, v } from "@/components/form";
import { companyAction, companyDocumentsAction, confirmPersonsAction, personAction } from "../actions";
import { initialState } from "../form-state";

// Company KYB steps (spec 03). No design board: they follow the applicant board patterns (A04-A06).
// Field names and server actions are unchanged.

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

export function CompanyForm(props: { saved: Saved; countries: Country[]; industries: Option[]; deposits: Option[]; sources: Option[]; back?: string }) {
  const [state, action] = useActionState(companyAction, initialState);
  const text = (name: string, label: string, optional?: boolean) => (
    <Field name={name} label={label} optional={optional} state={state}>
      <input id={name} name={name} defaultValue={v(state, props.saved, name)} />
    </Field>
  );
  const declared = state.values ? state.values.declaration === "on" : props.saved?.declaration === true;
  return (
    <form action={action} noValidate className="stack-lg">
      <FormMessage state={state} />
      <section className="stack" style={{ gap: 20 }}>
        {text("legalName", "Legal name")}
        <div className="row">
          {text("registrationNumber", "Registration number")}
          <Field name="countryOfIncorporation" label="Country of incorporation" state={state}>
            <Select name="countryOfIncorporation" options={countryOptions(props.countries)} value={v(state, props.saved, "countryOfIncorporation")} />
          </Field>
        </div>
      </section>
      <section className="stack divider" style={{ gap: 20 }}>
        <h2 className="section-title">Registered address</h2>
        {text("addressLine1", "Address")}
        <div className="row">
          {text("city", "City")}
          {text("postcode", "Postcode", true)}
          <Field name="addressCountry" label="Country" state={state}>
            <Select name="addressCountry" options={countryOptions(props.countries)} value={v(state, props.saved, "addressCountry")} />
          </Field>
        </div>
      </section>
      <section className="stack divider" style={{ gap: 20 }}>
        <h2 className="section-title">About the business</h2>
        <div className="row">
          <Field name="industry" label="Industry" state={state}><Select name="industry" options={props.industries} value={v(state, props.saved, "industry")} /></Field>
          {text("industryDetail", "Industry details (if Other)")}
        </div>
        <div className="row">
          <Field name="deposit_12m" label="Expected deposits in the next 12 months" state={state}><Select name="deposit_12m" options={props.deposits} value={v(state, props.saved, "deposit_12m")} /></Field>
          <Field name="source_of_funds" label="Main source of funds" state={state}><Select name="source_of_funds" options={props.sources} value={v(state, props.saved, "source_of_funds")} /></Field>
        </div>
      </section>
      <section className="stack divider">
        <Field name="declaration" label="" state={state}>
          <label className="choice top">
            <input type="checkbox" name="declaration" defaultChecked={declared} key={String(declared)} />
            <span>I am authorised to act for this company, and I declare that I have read, accept and fully understood the risk disclosure and the terms and conditions.</span>
          </label>
        </Field>
      </section>
      <div className="actions">
        <Submit>Continue</Submit>
        {props.back && <Link href={props.back} className="link">Back</Link>}
        <Link href="/" className="link">Finish later</Link>
      </div>
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
    <form action={action} noValidate className="stack-lg" style={{ gap: 28 }}>
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
        <legend>Roles (one person can have several)</legend>
        <div className="cards">
          {props.roles.map((r) => (
            <label key={r.id} className="choice-card" style={{ flexBasis: 220 }}>
              <input type="checkbox" name="roles" value={r.id} defaultChecked={savedRoles.includes(r.id)} /> {r.label}
            </label>
          ))}
        </div>
        {state.fieldErrors?.roles?.map((e) => <span key={e} className="error" role="alert">{e}</span>)}
      </fieldset>
      <Field name="sharePercent" label="Shareholding % (shareholders only)" state={state}>
        <input id="sharePercent" name="sharePercent" inputMode="decimal" defaultValue={v(state, props.saved, "sharePercent")} style={{ maxWidth: 200 }} />
      </Field>
      <fieldset className="field" data-invalid={state.fieldErrors?.pep ? "" : undefined} key={pep}>
        <legend style={{ fontSize: 14, lineHeight: 1.5 }}>Is this person, or have they been, a politically exposed person (PEP)?</legend>
        <div className="choices">
          <label className="choice"><input type="radio" name="pep" value="yes" defaultChecked={pep === "yes"} /> Yes</label>
          <label className="choice"><input type="radio" name="pep" value="no" defaultChecked={pep === "no"} /> No</label>
        </div>
        {state.fieldErrors?.pep?.map((e) => <span key={e} className="error" role="alert">{e}</span>)}
      </fieldset>
      {props.isApplicant ? (
        <p className="banner">Your own ID, selfie and proof of residence come in the next steps.</p>
      ) : (
        <div className="row">
          <Dropzone name="poi" label="Passport, ID card or driving licence" hint="Valid, all four corners visible." accept={props.documentAccept} onFile={props.onFile.poi} state={state} />
          <Dropzone name="por" label="Proof of residence" hint="Issued in the last 3 months." accept={props.documentAccept} onFile={props.onFile.por} state={state} />
        </div>
      )}
      <div className="actions">
        <Submit arrow={false} variant={props.isApplicant ? undefined : "outline"}>{props.personId ? "Save changes" : props.isApplicant ? "Save" : "Add person"}</Submit>
      </div>
    </form>
  );
}

export function ConfirmPersonsForm({ back }: { back?: string }) {
  const [state, action] = useActionState(confirmPersonsAction, initialState);
  return (
    <form action={action} className="stack">
      <FormMessage state={state} />
      <div className="actions">
        <Submit>Everyone is listed, continue</Submit>
        {back && <Link href={back} className="link">Back</Link>}
        <Link href="/" className="link">Finish later</Link>
      </div>
    </form>
  );
}

export function CompanyDocumentsForm(props: { items: { id: string; item: number; label: string; uploaded: string[] }[]; unsorted: string[]; documentAccept: string; back?: string }) {
  const [state, action] = useActionState(companyDocumentsAction, initialState);
  return (
    <form action={action} noValidate className="stack-lg" style={{ gap: 28 }}>
      <FormMessage state={state} />
      <ul className="check-list">
        {props.items.map((i) => (
          <li key={i.id} style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
            <div className="field" style={{ flex: "1 1 320px" }} data-invalid={state.fieldErrors?.[`doc_${i.id}`] ? "" : undefined}>
              <label htmlFor={`doc_${i.id}`}>{i.item}. {i.label}</label>
              <input id={`doc_${i.id}`} name={`doc_${i.id}`} type="file" multiple accept={props.documentAccept} />
              <OnFile name={i.uploaded.length ? i.uploaded.join(", ") : undefined} />
              {state.fieldErrors?.[`doc_${i.id}`]?.map((e) => <span key={e} className="error" role="alert">{e}</span>)}
            </div>
            <span className={`chip ${i.uploaded.length ? "pass" : "flag"}`}>{i.uploaded.length ? "Received" : "Missing"}</span>
          </li>
        ))}
      </ul>
      <Dropzone name="doc_unsorted" label="Other documents" hint="Not sure where a document belongs? Upload it here." accept={props.documentAccept} multiple onFile={props.unsorted.length ? props.unsorted.join(", ") : undefined} state={state} />
      <div className="actions">
        <Submit name="intent" value="finish">Upload and continue</Submit>
        <Submit name="intent" value="upload" variant="outline" arrow={false}>Upload only</Submit>
        {props.back && <Link href={props.back} className="link">Back</Link>}
      </div>
    </form>
  );
}
