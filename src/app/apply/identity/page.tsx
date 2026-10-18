import { Stepper } from "@/components/stepper";
import { COUNTRIES } from "@/lib/countries";
import { stepCase, type IdentityData } from "@/portal/cases";
import { onFileNames } from "../on-file";
import { IdentityForm } from "../_forms/step-forms";
import { requireStep } from "../session";

// 2.1.4 Proof of identity + selfie (D5)
export default async function IdentityPage() {
  const { deps, c } = await requireStep("identity");
  const saved = c.identity as IdentityData | null;
  const files = onFileNames(deps, c.id);
  return (
    <div className="card">
      <Stepper current="identity" c={stepCase(c)} />
      <h1>Proof of identity</h1>
      <p className="lede">A valid passport, ID card or driving licence, and a selfie.</p>
      <IdentityForm
        docTypes={deps.portal.poi.document_types}
        countries={[...COUNTRIES]}
        saved={saved}
        onFile={{ front: files.poi_front, back: files.poi_back, selfie: files.selfie }}
        documentAccept={deps.portal.uploads.document_mime.join(",")}
        selfieAccept={deps.portal.uploads.selfie_mime.join(",")}
        selfieRetry={saved?.selfie === "retry"}
      />
    </div>
  );
}
