import { ApplicantShell, backPath } from "@/components/applicant-shell";
import { COUNTRIES, countryName } from "@/lib/countries";
import { stepCase, type IdentityData, type ResidenceData } from "@/portal/cases";
import { lockedFromWallet } from "@/portal/evidence";
import { OTHER_OCCUPATION } from "@/portal/schemas";
import { QuestionnaireForm } from "../_forms/step-forms";
import { requireStep } from "../session";

const opts = (list: { id: string; label: string }[]) => list.map(({ id, label }) => ({ id, label }));

// 2.1.6 Questionnaire (docs/design/A06-Questionnaire.dc.html). Options and labels come from config/risk-matrix.yaml; the score is never shown.
export default async function QuestionnairePage() {
  const { deps, c, applicant } = await requireStep("questionnaire");
  const f = deps.engine.matrix.factors;
  const r = c.residence as ResidenceData;
  const address = [r.apartment, r.addressLine1, r.addressLine2, r.city, r.region, r.postcode, countryName(r.country)].filter(Boolean).join(", ");
  const sc = stepCase(c);
  return (
    <ApplicantShell
      panelTitle="A few questions"
      panelBody="Financial regulations require us to ask these. Answer as accurately as you can."
      c={sc}
      current="questionnaire"
      title="Questionnaire"
    >
      <QuestionnaireForm
        saved={c.questionnaire as Record<string, unknown> | null}
        locked={lockedFromWallet(c.identity as IdentityData | null)}
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
        back={backPath("questionnaire", sc)}
      />
    </ApplicantShell>
  );
}
