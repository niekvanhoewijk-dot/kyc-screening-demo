import Link from "next/link";
import { Stepper } from "@/components/stepper";
import { COUNTRIES, countryName } from "@/lib/countries";
import { stepCase } from "@/portal/cases";
import { personDocs, personsOf } from "@/portal/company";
import { removePersonAction } from "../actions";
import { ConfirmPersonsForm, PersonForm } from "../_forms/company-forms";
import { requireStep } from "../session";

// Representative, UBOs, shareholders and board members (spec 03). KYC is done on each of them.
export default async function PersonsPage({ searchParams }: { searchParams: Promise<{ edit?: string; add?: string }> }) {
  const { deps, c, applicant } = await requireStep("persons");
  const sp = await searchParams;
  const persons = personsOf(deps, c.id);
  const docs = personDocs(deps, c.id);
  const me = persons.find((p) => p.isApplicant);
  const editing = sp.edit ? persons.find((p) => p.id === sp.edit) : undefined;
  const roleLabel = (id: string) => deps.kyb.person_roles.find((r) => r.id === id)?.label.split(" (")[0] ?? id;
  const totalShares = persons.reduce((n, p) => n + (p.sharePercent ? Number(p.sharePercent) : 0), 0);
  const formProps = { countries: [...COUNTRIES], roles: deps.kyb.person_roles, documentAccept: deps.portal.uploads.document_mime.join(",") };
  const fileOf = (personId: string, kind: string) => docs.find((d) => d.personId === personId && d.kind === kind)?.originalName;

  return (
    <div className="card">
      <Stepper current="persons" c={stepCase(c)} />
      <h1>People involved</h1>
      <p className="lede">We verify everyone who represents, owns or directs the company: you, the ultimate beneficial owner(s), all shareholders and all board members. One person can have several roles.</p>

      {!me || editing?.isApplicant ? (
        <>
          <h2 className="section-title" style={{ borderTop: 0, paddingTop: 0 }}>About you</h2>
          <PersonForm {...formProps} isApplicant saved={me ?? { fullName: `${applicant.firstName} ${applicant.lastName}` }} personId={me?.id} onFile={{}} />
        </>
      ) : (
        <>
          <table>
            <thead><tr><th>Name</th><th>Roles</th><th>Documents</th><th /></tr></thead>
            <tbody>
              {persons.map((p) => (
                <tr key={p.id}>
                  <td>{p.fullName}{p.isApplicant && " (you)"}<br /><span className="muted">{countryName(p.countryOfResidence)}</span></td>
                  <td>{(p.roles as string[]).map(roleLabel).join(", ")}{p.sharePercent && ` · ${p.sharePercent}%`}</td>
                  <td>{p.isApplicant ? <span className="muted">Next steps</span> : <>{fileOf(p.id, "person_poi") ? "ID ✓" : "ID missing"} · {fileOf(p.id, "person_por") ? "Address ✓" : "Address missing"}</>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Link href={`/apply/persons?edit=${p.id}`}>Edit</Link>
                    {!p.isApplicant && (
                      <form action={removePersonAction} style={{ display: "inline", marginLeft: 8 }}>
                        <input type="hidden" name="personId" value={p.id} />
                        <button type="submit" className="btn small secondary">Remove</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalShares > 0 && totalShares !== deps.kyb.shareholding_total_percent && (
            <div className="banner info" style={{ marginTop: 12 }}>Declared shareholdings add up to {totalShares}%. Please list every shareholder, so they add up to {deps.kyb.shareholding_total_percent}%.</div>
          )}
          <h2 className="section-title">{editing ? `Edit ${editing.fullName}` : "Add a person"}</h2>
          <PersonForm
            key={editing?.id ?? "new"}
            {...formProps}
            isApplicant={false}
            personId={editing?.id}
            saved={editing ?? null}
            onFile={editing ? { poi: fileOf(editing.id, "person_poi"), por: fileOf(editing.id, "person_por") } : {}}
          />
          {editing && <p><Link href="/apply/persons">Cancel editing</Link></p>}
          <h2 className="section-title">Done?</h2>
          <ConfirmPersonsForm />
        </>
      )}
    </div>
  );
}
