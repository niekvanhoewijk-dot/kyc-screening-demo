import Link from "next/link";
import { redirect } from "next/navigation";
import { ApplicantShell, backPath } from "@/components/applicant-shell";
import { Ticked } from "@/components/icons";
import { stepCase, type IdentityData } from "@/portal/cases";
import { walletEvidenceOf } from "@/portal/evidence";
import { applicantView } from "@/portal/decision";
import { resumeStep, stepPath } from "@/portal/steps";
import { signOutAction } from "../actions";
import { EddForm, SubmitForm } from "../_forms/step-forms";
import { requireStep } from "../session";
import { NO_GO_TEXT } from "@/portal/status-text";

// D7: neutral, no reasons. Never reveals sanctions, PEP, watchlist or risk-score reasons.
const NO_GO = NO_GO_TEXT;
// The board (A10) shows the first sentence as the heading and the rest below it: same text, split.
const [NO_GO_HEADING, ...NO_GO_REST] = NO_GO.split(/(?<=\.) /);

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function SignOut() {
  return (
    <form action={signOutAction}>
      <button className="link-btn" type="submit">Sign out</button>
    </form>
  );
}

// 2.1.7 Check (A07), EDD request (A08), 2.1.8 Confirmation (A09), not approved (A10).
export default async function StatusPage() {
  const { c, deps, applicant } = await requireStep("check");
  const view = applicantView(c);
  const sc = stepCase(c);
  if (view.kind === "draft" && resumeStep(sc) !== "check") redirect(stepPath(resumeStep(sc)));
  const reference = c.id.slice(0, "xxxxxxxx".length).toUpperCase();
  const company = c.persona === "company";

  switch (view.kind) {
    case "draft":
      return (
        <ApplicantShell
          panelTitle="Almost there"
          panelBody="Check that everything is right. Once you submit, your answers can no longer be changed."
          c={sc}
          current="check"
          title="Ready to submit"
          lede="You can still go back to any step in the panel. A member of our team reviews every application."
          narrow
        >
          <SubmitForm />
          <div className="actions">
            {backPath("check", sc) && <Link href={backPath("check", sc)!} className="link">Back</Link>}
            <Link href="/" className="link">Finish later</Link>
          </div>
        </ApplicantShell>
      );
    case "check":
      return (
        <ApplicantShell
          panelTitle="We are reviewing your details"
          panelBody="We will confirm either way as soon as we can. You do not need to do anything now."
          c={sc}
          current="check"
          title={`Thank you, ${applicant.firstName}`}
          lede="We have everything we need for now. A member of our team reviews every application, and we will confirm either way as soon as possible."
          narrow
        >
          <ol className="numbered compact">
            <li><span className="num">1</span><div><h2>We review your documents and answers</h2><p>This is done by a person, with checks that run alongside.</p></div></li>
            <li><span className="num">2</span><div><h2>We may ask a follow-up question</h2><p>If something is unclear, you will see exactly what we need when you sign in again.</p></div></li>
            <li><span className="num">3</span><div><h2>You hear from us</h2><p>With the outcome and what happens next.</p></div></li>
          </ol>
          <p className="banner">Your reference: <strong>{reference}</strong></p>
          <div className="actions"><SignOut /></div>
        </ApplicantShell>
      );
    case "edd":
      return (
        <ApplicantShell
          panelTitle="One more thing"
          panelBody="To continue we need to confirm where your funds come from. It is a standard request."
          c={sc}
          current="check"
          eyebrow="Additional information"
          title="We need a little more from you"
          lede="Financial regulations ask us to confirm this from time to time. Once we have it, we can continue with your application."
        >
          <EddForm extraKyc={view.extraKyc} documentAccept={deps.portal.uploads.document_mime.join(",")} selfieAccept={deps.portal.uploads.selfie_mime.join(",")} />
          <div className="actions"><SignOut /></div>
        </ApplicantShell>
      );
    case "confirmation":
      return (
        <ApplicantShell
          panelTitle="You are verified"
          panelBody="Your details are confirmed and your account is ready."
          c={sc}
          current="confirmation"
          title="Your account is approved"
          lede={`Thank you for your patience, ${applicant.firstName}.`}
          narrow
        >
          {view.threshold !== null && (
            <div className="limit-box">
              <span className="eyebrow">Your current deposit limit</span>
              <span className="amount">{usd(view.threshold)}</span>
              <p>You can deposit up to this amount. To go above it, we may ask for extra documents first.</p>
            </div>
          )}
          <ul className="check-list">
            <li><span>{company ? "Your identity and selfie" : walletEvidenceOf(c.identity as IdentityData | null) ? "Proof of identity (ID wallet)" : "Proof of identity and selfie"}</span><Ticked>Verified</Ticked></li>
            <li><span>{company ? "Your proof of residence" : "Proof of residence"}</span><Ticked>Verified</Ticked></li>
            <li><span>{company ? "Company details, people and documents" : "Questionnaire"}</span><Ticked>Completed</Ticked></li>
          </ul>
          <p className="banner">Illustrative demo: no real account is opened and no money moves.</p>
          <div className="actions"><SignOut /></div>
        </ApplicantShell>
      );
    case "no_go":
      return (
        <ApplicantShell
          panelTitle="Thank you for your interest"
          panelBody="We appreciate the time you took to apply."
          c={sc}
          current={null}
          eyebrow={null}
          title={NO_GO_HEADING}
          lede={NO_GO_REST.join(" ")}
          narrow
          center
        >
          <div className="actions">
            <SignOut />
            <Link href="/" className="link">Back to home</Link>
          </div>
        </ApplicantShell>
      );
    case "por_expired":
      return (
        <ApplicantShell
          panelTitle="Time for an update"
          panelBody="Your proof of residence has expired. Upload a new one to continue."
          c={sc}
          current={null}
          eyebrow="Action needed"
          title="Please update your proof of residence"
          lede="Deposits and withdrawals are paused until a new one is approved."
          narrow
        >
          <div className="actions"><SignOut /></div>
        </ApplicantShell>
      );
  }
}
