import { Stepper } from "@/components/stepper";
import { COUNTRIES } from "@/lib/countries";
import { stepCase } from "@/portal/cases";
import { OTHER_OCCUPATION } from "@/portal/schemas";
import { CompanyForm } from "../_forms/company-forms";
import { requireStep } from "../session";

const opts = (l: { id: string; label: string }[]) => l.map(({ id, label }) => ({ id, label }));

// Company details and corporate questionnaire (spec 03 item 12).
export default async function CompanyPage() {
  const { deps, c } = await requireStep("company");
  const f = deps.engine.matrix.factors;
  return (
    <div className="card">
      <Stepper current="company" c={stepCase(c)} />
      <h1>About the company</h1>
      <p className="lede">As registered. You&apos;ll add the people involved in the next step.</p>
      <CompanyForm
        saved={c.company as Record<string, unknown> | null}
        countries={[...COUNTRIES]}
        industries={[...opts(f.occupation_industry.values), OTHER_OCCUPATION]}
        deposits={opts(f.deposit_12m)}
        sources={opts(f.source_of_funds)}
      />
    </div>
  );
}
