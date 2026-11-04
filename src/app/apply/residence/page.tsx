import { ApplicantShell, backPath } from "@/components/applicant-shell";
import { COUNTRIES } from "@/lib/countries";
import { stepCase, type IdentityData } from "@/portal/cases";
import { residencePrefill } from "@/portal/evidence";
import { onFileNames } from "../on-file";
import { ResidenceForm } from "../_forms/step-forms";
import { requireStep } from "../session";

// 2.1.5 Address + proof of residence (docs/design/A05-Proof-Of-Residence.dc.html, D10)
export default async function ResidencePage() {
  const { deps, c } = await requireStep("residence");
  const sc = stepCase(c);
  // From the ID wallet, if it carried an address and nothing is saved yet (O-71: still editable, proof still needed).
  const prefill = c.residence ? null : residencePrefill(c.identity as IdentityData | null);
  return (
    <ApplicantShell
      panelTitle="Where you live"
      panelBody={`Enter your address, then add one document that shows it. It must be issued in the last ${deps.portal.por.max_age_months} months.`}
      c={sc}
      current="residence"
      title={c.persona === "company" ? "Your proof of residence" : "Proof of residence"}
    >
      {prefill && <p className="banner">Pre-filled from your ID wallet. Check it and correct anything that is out of date.</p>}
      <ResidenceForm
        porTypes={deps.portal.por.document_types}
        countries={[...COUNTRIES]}
        saved={(c.residence as Record<string, unknown> | null) ?? prefill}
        onFile={onFileNames(deps, c.id).por}
        documentAccept={deps.portal.uploads.document_mime.join(",")}
        maxAgeMonths={deps.portal.por.max_age_months}
        back={backPath("residence", sc)}
      />
    </ApplicantShell>
  );
}
