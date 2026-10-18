import type { ReactNode } from "react";
import Link from "next/link";
import { getMode, MODE_LABEL, type Mode } from "@/console/mode";
import { portalDeps } from "@/portal/deps";
import { chooseAnalystAction, setModeAction } from "./actions";
import { currentAnalyst } from "./analyst-session";

export const dynamic = "force-dynamic";

export default async function AnalystLayout({ children }: { children: ReactNode }) {
  const deps = portalDeps();
  const analyst = await currentAnalyst();
  const mode = getMode(deps);
  return (
    <div>
      <div className="console-bar">
        <div>
          <Link href="/analyst" style={{ fontWeight: 700, textDecoration: "none", color: "inherit" }}>Analyst console</Link>{" "}
          <span className="pill" title="Operating mode">{MODE_LABEL[mode]}</span>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <form action={chooseAnalystAction}>
            <label htmlFor="analyst" className="muted">Working as</label>
            <select id="analyst" name="analyst" defaultValue={analyst?.id ?? ""} key={analyst?.id ?? "none"}>
              <option value="" disabled>Choose…</option>
              {deps.consoleConfig.analysts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="btn small secondary" type="submit">Set</button>
          </form>
          {analyst && (
            <form action={setModeAction}>
              <label htmlFor="mode" className="muted">Mode</label>
              <select id="mode" name="mode" defaultValue={mode} key={mode}>
                {(Object.keys(MODE_LABEL) as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </select>
              <button className="btn small secondary" type="submit">Switch</button>
            </form>
          )}
        </div>
      </div>
      {analyst ? children : (
        <div className="card">
          <h1>Who is working?</h1>
          <p className="lede">Choose an analyst above. Every action in the console is recorded under that name in the audit trail. (Demo: no real sign-in.)</p>
        </div>
      )}
    </div>
  );
}
