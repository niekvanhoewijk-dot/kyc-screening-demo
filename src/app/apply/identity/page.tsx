import { ApplicantShell, backPath } from "@/components/applicant-shell";
import { COUNTRIES } from "@/lib/countries";
import { stepCase, type IdentityData } from "@/portal/cases";
import { onFileNames } from "../on-file";
import { IdentityForm } from "../_forms/step-forms";
import { requireStep } from "../session";

// 2.1.4 Proof of identity + selfie (docs/design/A04-Proof-Of-Identity.dc.html, D5)
export default async function IdentityPage() {
  const { deps, c } = await requireStep("identity");
  const saved = c.identity as IdentityData | null;
  const files = onFileNames(deps, c.id);
  const sc = stepCase(c);
  return (
    <ApplicantShell
      panelTitle="Prove who you are"
      panelBody="Upload a photo of your ID, then take a selfie. Both take under two minutes."
      c={sc}
      current="identity"
      title={c.persona === "company" ? "Your proof of identity" : "Proof of identity"}
    >
      <IdentityForm
        docTypes={deps.portal.poi.document_types}
        countries={[...COUNTRIES]}
        saved={saved}
        onFile={{ front: files.poi_front, back: files.poi_back, selfie: files.selfie }}
        documentAccept={deps.portal.uploads.document_mime.join(",")}
        selfieAccept={deps.portal.uploads.selfie_mime.join(",")}
        selfieRetry={saved?.selfie === "retry"}
        back={backPath("identity", sc)}
      />
    </ApplicantShell>
  );
}
