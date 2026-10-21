import { ApplicantShell, backPath } from "@/components/applicant-shell";
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
  const sc = stepCase(c);
  return (
    <ApplicantShell
      panelTitle="About the company"
      panelBody="As registered. You add the people involved and the company documents in the next steps."
      c={sc}
      current="company"
      title="Company details"
      lede="The company as it is registered, plus a few questions about the business."
    >
      <CompanyForm
        saved={c.company as Record<string, unknown> | null}
        countries={[...COUNTRIES]}
        industries={[...opts(f.occupation_industry.values), OTHER_OCCUPATION]}
        deposits={opts(f.deposit_12m)}
        sources={opts(f.source_of_funds)}
        back={backPath("company", sc)}
      />
    </ApplicantShell>
  );
}
