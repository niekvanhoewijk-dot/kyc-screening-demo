import type { ReactNode } from "react";
import { AnalystNav } from "@/components/analyst-nav";
import { demoChoices, getDemoState } from "@/demo/prefill";
import { env } from "@/lib/env";
import { portalDeps } from "@/portal/deps";
import { currentAnalyst } from "./analyst-session";

export const dynamic = "force-dynamic";

// Analyst frame (docs/design/AnalystNav.dc.html + C01-C03): nav rail + content.
export default async function AnalystLayout({ children }: { children: ReactNode }) {
  const deps = portalDeps();
  const analyst = await currentAnalyst();
  const demo = getDemoState(deps);
  const demoNote = demo.on ? `Demo Mode on: ${demoChoices().find((c) => c.id === demo.persona)?.name ?? demo.persona}` : null;
  return (
    <div className="frame">
      <AnalystNav
        analysts={deps.consoleConfig.analysts}
        current={analyst}
        demoNote={demoNote}
        claudeSource={env.DEMO_MODE === "replay" ? "replay of recorded responses" : `live API (${env.CLAUDE_MODEL})`}
      />
      <main className="an-main">
        {analyst ? children : (
          <div className="head">
            <span className="eyebrow">Analyst console</span>
            <h1 className="title">Who is working?</h1>
            <p className="lede">Choose an analyst under &quot;Signed in as&quot;. Every action in the console is recorded under that name in the audit trail. Demo: no real sign-in.</p>
          </div>
        )}
      </main>
    </div>
  );
}
