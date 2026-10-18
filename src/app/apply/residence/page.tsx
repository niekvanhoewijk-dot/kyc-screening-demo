import { Stepper } from "@/components/stepper";
import { COUNTRIES } from "@/lib/countries";
import { stepCase } from "@/portal/cases";
import { onFileNames } from "../on-file";
import { ResidenceForm } from "../_forms/step-forms";
import { requireStep } from "../session";

// 2.1.5 Address + proof of residence (D10)
export default async function ResidencePage() {
  const { deps, c } = await requireStep("residence");
  return (
    <div className="card">
      <Stepper current="residence" c={stepCase(c)} />
      <h1>Proof of residence</h1>
      <p className="lede">Your home address and one document that shows it.</p>
      <ResidenceForm
        porTypes={deps.portal.por.document_types}
        countries={[...COUNTRIES]}
        saved={c.residence as Record<string, unknown> | null}
        onFile={onFileNames(deps, c.id).por}
        documentAccept={deps.portal.uploads.document_mime.join(",")}
        maxAgeMonths={deps.portal.por.max_age_months}
      />
    </div>
  );
}
