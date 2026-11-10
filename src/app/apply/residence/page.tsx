import { ApplicantShell, backPath } from "@/components/applicant-shell";
import { stepCase } from "@/portal/cases";
import { residenceFormProps } from "../_forms/props";
import { ResidenceForm } from "../_forms/step-forms";
import { requireStep } from "../session";

// 2.1.5 Address + proof of residence (docs/design/A05-Proof-Of-Residence.dc.html, D10)
export default async function ResidencePage({ searchParams }: { searchParams: Promise<{ via?: string }> }) {
  const { via } = await searchParams;
  const { deps, c } = await requireStep("residence");
  const sc = stepCase(c);
  const fromAssistant = via === "assistant";
  const { prefilled, form } = residenceFormProps(deps, c);
  return (
    <ApplicantShell
      panelTitle="Where you live"
      panelBody={`Enter your address, then add one document that shows it. It must be issued in the last ${deps.portal.por.max_age_months} months.`}
      c={sc}
      current="residence"
      title={c.persona === "company" ? "Your proof of residence" : "Proof of residence"}
    >
      {prefilled && <p className="banner">Pre-filled from your ID wallet. Check it and correct anything that is out of date.</p>}
      <ResidenceForm {...form} back={fromAssistant ? "/apply/interview" : backPath("residence", sc)} returnTo={fromAssistant} />
    </ApplicantShell>
  );
}
