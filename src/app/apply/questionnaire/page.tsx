import { Stepper } from "@/components/stepper";
import { COUNTRIES, countryName } from "@/lib/countries";
import { stepCase, type ResidenceData } from "@/portal/cases";
import { OTHER_OCCUPATION } from "@/portal/schemas";
import { QuestionnaireForm } from "../_forms/step-forms";
import { requireStep } from "../session";

const opts = (list: { id: string; label: string }[]) => list.map(({ id, label }) => ({ id, label }));

// 2.1.6 Questionnaire. Options and labels come from config/risk-matrix.yaml; the score is never shown.
export default async function QuestionnairePage() {
  const { deps, c, applicant } = await requireStep("questionnaire");
  const f = deps.engine.matrix.factors;
  const r = c.residence as ResidenceData;
  const address = [r.apartment, r.addressLine1, r.addressLine2, r.city, r.region, r.postcode, countryName(r.country)].filter(Boolean).join(", ");
  return (
    <div className="card">
      <Stepper current="questionnaire" c={stepCase(c)} />
      <h1>A few questions</h1>
      <p className="lede">Regulation requires us to ask these. It takes about 5 minutes.</p>
      <QuestionnaireForm
        saved={c.questionnaire as Record<string, unknown> | null}
        email={applicant.email}
        address={address}
        countries={[...COUNTRIES]}
        languages={deps.portal.questionnaire.preferred_languages}
        factors={{
          deposit_12m: opts(f.deposit_12m),
          source_of_funds: opts(f.source_of_funds),
          employment_status: opts(f.employment_status),
          occupation_industry: [...opts(f.occupation_industry.values), OTHER_OCCUPATION],
          annual_income: opts(f.annual_income),
          net_worth: opts(f.net_worth),
        }}
      />
    </div>
  );
}
