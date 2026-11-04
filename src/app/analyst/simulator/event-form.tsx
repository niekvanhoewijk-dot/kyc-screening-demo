"use client";

import { useActionState, useState } from "react";
import { FormMessage, Submit } from "@/components/form";
import { initialState } from "../../apply/form-state";
import { eventAction } from "./actions";
import { EVENT_LABEL } from "./labels";

type Option = { id: string; label: string };
type EventType = keyof typeof EVENT_LABEL;

/** Event injector (spec 08 5.4, 5.6 item 4): pick a synthetic customer, an event and its fields. */
export function EventForm({
  customers,
  factors,
  simDate,
  defaults = {},
}: {
  customers: Option[];
  factors: (Option & { options: Option[] })[];
  simDate: string;
  /** Prefill from a scenario preset. */
  defaults?: { subject?: string; type?: string; amount?: string };
}) {
  const [state, run] = useActionState(eventAction, initialState);
  const [type, setType] = useState<EventType>(defaults.type && defaults.type in EVENT_LABEL ? (defaults.type as EventType) : "deposit");
  const [field, setField] = useState("country");
  const [noSof, setNoSof] = useState(false);
  const factor = factors.find((f) => f.id === field);
  return (
    <form action={run} className="stack">
      <input type="hidden" name="at" value={simDate} />
      <div className="row">
        <div className="field">
          <label htmlFor="ev-subject">Customer</label>
          <select id="ev-subject" name="subject" defaultValue={customers.some((c) => c.id === defaults.subject) ? defaults.subject : customers[0]?.id}>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ev-type">Event</label>
          <select id="ev-type" name="type" value={type} onChange={(e) => setType(e.target.value as EventType)}>
            {Object.entries(EVENT_LABEL).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select>
        </div>
      </div>

      {type === "deposit" && (
        <div className="field">
          <label htmlFor="ev-amount">Amount deposited (USD)</label>
          <input id="ev-amount" name="amount" inputMode="decimal" required aria-describedby="ev-amount-hint" defaultValue={defaults.amount} />
          <span className="hint" id="ev-amount-hint">Added to deposits to date. At or above the threshold, the customer goes to EDD.</span>
        </div>
      )}
      {type === "por_replaced" && (
        <div className="field">
          <label htmlFor="ev-issued">Issue date of the new proof of residence</label>
          <input id="ev-issued" name="issued_at" type="date" defaultValue={simDate} required />
        </div>
      )}
      {type === "circumstance_change" && (
        <div className="row">
          <div className="field">
            <label htmlFor="ev-field">What changed</label>
            <select id="ev-field" name="field" value={field} onChange={(e) => setField(e.target.value)}>
              <option value="country">Country of residence</option>
              {factors.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          {field === "country" ? (
            <div className="field">
              <label htmlFor="ev-country">New country (ISO code)</label>
              <input id="ev-country" name="country_value" required pattern="[A-Za-z]{2}" maxLength={2} autoCapitalize="characters" aria-describedby="ev-country-hint" />
              <span className="hint" id="ev-country-hint">Two letters, e.g. KE or NL. Opens an event-driven review (AMLR Art. 26(3)).</span>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="ev-factor">New answer</label>
              <select id="ev-factor" name="factor_value">
                {factor?.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
      {type === "pep_confirmed" && <p className="hint">The customer is confirmed as a PEP: the engine re-scores to at least High (D9).</p>}
      {type === "edd_outcome" && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="ev-documented">Annual amount evidenced by the source-of-funds documents (USD)</label>
            <input id="ev-documented" name="documented" inputMode="decimal" required={!noSof} disabled={noSof} />
          </div>
          <label className="choice">
            <input type="checkbox" name="noSof" checked={noSof} onChange={(e) => setNoSof(e.target.checked)} />
            No source of funds provided
          </label>
        </div>
      )}

      <div><Submit pending="Applying…" arrow={false}>Inject event</Submit></div>
      <FormMessage state={state} />
    </form>
  );
}
