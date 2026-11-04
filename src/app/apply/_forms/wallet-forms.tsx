"use client";

import { useActionState } from "react";
import { FormMessage, Submit } from "@/components/form";
import { presentTestWalletAction } from "../actions";
import { initialState } from "../form-state";

// ID wallet route (docs/spec/09). The test wallet panel only exists in test mode (O-68).

type Scenario = { id: string; label: string; outcome: string };

export function TestWalletPanel({ scenarios }: { scenarios: Scenario[] }) {
  const [state, action] = useActionState(presentTestWalletAction, initialState);
  const error = state.fieldErrors?.scenario;
  return (
    <form action={action} noValidate className="panel-soft" aria-labelledby="test-wallet-title">
      <span className="eyebrow">Test mode</span>
      <h2 id="test-wallet-title" className="section-title">Test wallet</h2>
      <p style={{ fontSize: 14, lineHeight: 1.65, color: "#262626" }}>
        No real wallet is connected. This built-in test wallet holds made-up data under your name. Choose what it should do, then share.
      </p>
      <FormMessage state={state} />
      <div className="field" data-invalid={error?.length ? "" : undefined}>
        <label htmlFor="scenario">What the test wallet does</label>
        <select id="scenario" name="scenario" defaultValue={state.values?.scenario ?? "valid"}>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>{s.label} ({s.outcome})</option>
          ))}
        </select>
        {error?.map((e) => <span key={e} className="error" role="alert">{e}</span>)}
      </div>
      <div className="actions"><Submit pending="Sharing…">Share from test wallet</Submit></div>
    </form>
  );
}
