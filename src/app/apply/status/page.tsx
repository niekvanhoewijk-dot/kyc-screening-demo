import { redirect } from "next/navigation";
import { Stepper } from "@/components/stepper";
import { stepCase } from "@/portal/cases";
import { applicantView } from "@/portal/decision";
import { resumeStep, stepPath } from "@/portal/steps";
import { signOutAction } from "../actions";
import { EddForm, SubmitForm } from "../_forms/step-forms";
import { requireStep } from "../session";

// D7: neutral, no reasons. Never reveals sanctions, PEP, watchlist or risk-score reasons.
const NO_GO =
  "We're unable to open an account for you at this time. This follows from our regulatory requirements. If you think this is a mistake, contact support.";

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

// 2.1.7 Check, then the outcome screens: 2.1.8 Confirmation, EDD, no-go.
export default async function StatusPage() {
  const { c, deps } = await requireStep("check");
  const view = applicantView(c);
  if (view.kind === "draft" && resumeStep(stepCase(c)) !== "check") redirect(stepPath(resumeStep(stepCase(c))));

  const body = (() => {
    switch (view.kind) {
      case "draft":
        return (
          <>
            <h1>Ready to submit</h1>
            <p className="lede">You can still go back to any step using the progress bar above. Once you submit, your answers can no longer be changed.</p>
            <SubmitForm />
          </>
        );
      case "check":
        return (
          <>
            <h1>Thank you, we're checking your application</h1>
            <p className="lede">We will confirm either way as soon as possible. You don't need to do anything now.</p>
          </>
        );
      case "confirmation":
        return (
          <>
            <h1>Your account is approved</h1>
            <div className="banner ok" role="status">Welcome aboard. You can now make deposits.</div>
            {view.threshold !== null && (
              <>
                <p style={{ marginBottom: 4 }}>Your deposit limit</p>
                <p className="amount" style={{ marginTop: 0 }}>{usd(view.threshold)}</p>
                <p className="lede">If you'd like to deposit more later, we'll ask for proof of your source of funds.</p>
              </>
            )}
          </>
        );
      case "edd":
        return (
          <>
            <h1>We need a little more information</h1>
            <p className="lede">To complete your application, please send proof of where your funds come from.</p>
            <EddForm extraKyc={view.extraKyc} documentAccept={deps.portal.uploads.document_mime.join(",")} selfieAccept={deps.portal.uploads.selfie_mime.join(",")} />
          </>
        );
      case "no_go":
        return (
          <>
            <h1>Application update</h1>
            <p>{NO_GO}</p>
          </>
        );
      case "por_expired":
        return (
          <>
            <h1>Please update your proof of residence</h1>
            <p className="lede">Your proof of residence has expired. Deposits and withdrawals are paused until a new one is approved.</p>
          </>
        );
    }
  })();

  return (
    <div className="card">
      {view.kind === "draft" && <Stepper current="check" c={stepCase(c)} />}
      {body}
      <form action={signOutAction} style={{ marginTop: 24 }}>
        <button className="btn secondary" type="submit">Sign out</button>
      </form>
    </div>
  );
}
