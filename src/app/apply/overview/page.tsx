import { Stepper } from "@/components/stepper";
import { uploadableItems } from "@/engine";
import { stepCase } from "@/portal/cases";
import { startAction } from "../actions";
import { requireStep } from "../session";

// 2.1.3 Overview: what to have ready. Also the landing point for returning applicants.
export default async function OverviewPage() {
  const { c, applicant, deps } = await requireStep("overview");
  const { poi, por } = deps.portal;
  const started = c.overviewSeenAt !== null;
  return (
    <div className="card">
      <Stepper current="overview" c={stepCase(c)} />
      <h1>{started ? `Welcome back, ${applicant.firstName}` : `Hi ${applicant.firstName}, before you start`}</h1>
      <p className="lede">Have these ready. Your progress is saved after each step, so you can stop and come back.</p>
      <ol>
        {c.persona === "company" && (
          <>
            <li><strong>Company details</strong>: registration number, registered address, expected deposits.</li>
            <li><strong>The people involved</strong>: an ID and proof of residence for every ultimate beneficial owner, shareholder and board member.</li>
          </>
        )}
        <li>
          <strong>{c.persona === "company" ? "Your own proof of identity" : "Proof of identity"}</strong>: {poi.document_types.map((d) => d.label).join(", ")}. Valid, with all four corners visible.
        </li>
        <li><strong>A selfie</strong>{c.persona === "company" ? " of you, the representative" : ""}, taken in good light, facing the camera.</li>
        <li>
          <strong>{c.persona === "company" ? "Your own proof of residence" : "Proof of residence"}</strong> issued in the last {por.max_age_months} months, with all four corners visible: {por.document_types.map((d) => d.label.split(" (")[0]!.toLowerCase()).join("; ")}. Mobile phone bills, envelopes and P.O. boxes are not accepted.
        </li>
        {c.persona === "company" ? (
          <li><strong>Company documents</strong>: {uploadableItems(deps.kyb).map((i) => i.label.toLowerCase()).slice(0, 3).join("; ")} and more ({uploadableItems(deps.kyb).length} in total).</li>
        ) : (
          <li><strong>A few questions</strong> about you, your tax residence and your expected deposits. About 5 minutes.</li>
        )}
      </ol>
      <form action={startAction} className="actions">
        <button className="btn" type="submit">{started ? "Continue" : "Start"}</button>
      </form>
    </div>
  );
}
