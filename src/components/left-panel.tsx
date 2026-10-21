import Link from "next/link";
import { CheckIcon } from "./icons";

export type PanelStep = { id: string; label: string; state: "done" | "current" | "todo"; href?: string };

/** Applicant side panel (docs/design/LeftPanel.dc.html): black, vertical stepper, grayscale dunes. */
export function LeftPanel({ title, body, steps }: { title: string; body: string; steps?: PanelStep[] }) {
  return (
    <aside className="lp on-dark" aria-label="About this step">
      <div className="lp-head">
        <Link href="/" className="lp-brand">Demo Digital Assets Platform</Link>
        <h2 className="lp-title">{title}</h2>
        <p className="lp-body">{body}</p>
      </div>
      {steps && steps.length > 0 && (
        <nav aria-label="Verification progress">
          <ol className="lp-steps">
            {steps.map((s, i) => {
              const label = <span className="lp-label">{s.label}</span>;
              return (
                <li key={s.id} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
                  <span className="lp-dot">{s.state === "done" ? <CheckIcon color="#0A0A0A" /> : String(i + 1).padStart(2, "0")}</span>
                  {s.href && s.state === "done" ? <Link href={s.href}>{label}</Link> : label}
                  {s.state === "done" && <span className="sr-only">(done)</span>}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <svg className="lp-dunes" viewBox="0 0 440 260" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 110 C 70 40, 150 100, 230 60 S 380 10, 440 60 L440 260 L0 260 Z" fill="#161616" />
        <path d="M0 170 C 90 110, 190 160, 290 120 S 400 110, 440 140 L440 260 L0 260 Z" fill="#212121" />
        <path d="M0 215 C 110 170, 210 215, 320 185 S 410 180, 440 195 L440 260 L0 260 Z" fill="#050505" />
      </svg>
      <p className="lp-foot">Illustrative demo on synthetic data. Not a regulated compliance system. Never enter real personal data.</p>
    </aside>
  );
}
