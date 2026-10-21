import { ApplicantShell } from "@/components/applicant-shell";
import { ArrowIcon } from "@/components/icons";
import { uploadableItems } from "@/engine";
import { stepCase } from "@/portal/cases";
import { startAction } from "../actions";
import { requireStep } from "../session";

// Lowercase a leading capital only when a lowercase letter follows ("Passport" -> "passport", "ID card" stays).
const lower = (s: string) => s.replace(/^([A-Z])(?=[a-z])/, (m) => m.toLowerCase());

// 2.1.3 Overview (docs/design/A03-Overview.dc.html). Also the landing point for returning applicants.
export default async function OverviewPage() {
  const { c, applicant, deps } = await requireStep("overview");
  const { poi, por } = deps.portal;
  const started = c.overviewSeenAt !== null;
  const company = c.persona === "company";
  const items = [
    ...(company
      ? [
          { h: "Company details", p: "Registration number, registered address and what the company expects to deposit." },
          { h: "The people involved", p: "An ID and a proof of residence for every ultimate beneficial owner, shareholder and board member." },
        ]
      : []),
    {
      h: company ? "Your own photo ID and a selfie" : "Photo ID and a selfie",
      p: `A ${poi.document_types.map((d) => lower(d.label)).join(", ").replace(/, ([^,]*)$/, " or $1")}. It must be valid and show all four corners. The selfie confirms the photo is you and is handled by our verification partner.`,
    },
    {
      h: company ? "Your own proof of address" : "Proof of address",
      p: `One document issued in the last ${por.max_age_months} months: ${por.document_types.map((d) => lower(d.label.split(" (")[0]!)).join(", ").replace(/, ([^,]*)$/, ", or $1")} that shows where you live.`,
    },
    company
      ? { h: "Company documents", p: `${uploadableItems(deps.kyb).map((i) => i.label.split(" (")[0]).slice(0, 3).join("; ")} and more: ${uploadableItems(deps.kyb).length} in total. Missing ones don't block you; we'll ask.` }
      : { h: "A few questions about your finances", p: "Employment, income, source of funds and what you expect to deposit. We ask these to meet financial regulations." },
  ];
  return (
    <ApplicantShell
      panelTitle="What you will need"
      panelBody="Have these ready and the rest takes about ten minutes. Your progress is saved as you go."
      c={stepCase(c)}
      current="overview"
      title={started ? `Welcome back, ${applicant.firstName}` : "Before you start"}
      lede={`${items.length === 3 ? "Three" : items.length} things are needed to open an account. You do not have to finish in one sitting.`}
    >
      <ol className="numbered">
        {items.map((it, i) => (
          <li key={it.h}>
            <span className="num">{i + 1}</span>
            <div>
              <h2>{it.h}</h2>
              <p>{it.p}</p>
            </div>
          </li>
        ))}
      </ol>
      <form action={startAction} className="actions">
        <button className="btn" type="submit">{started ? "Continue" : "Start verification"} <ArrowIcon /></button>
        <span className="muted">About 10 minutes. Save and return at any time.</span>
      </form>
    </ApplicantShell>
  );
}
