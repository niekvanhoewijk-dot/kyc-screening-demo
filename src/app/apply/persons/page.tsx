import Link from "next/link";
import { ApplicantShell, backPath } from "@/components/applicant-shell";
import { Ticked } from "@/components/icons";
import { COUNTRIES, countryName } from "@/lib/countries";
import { stepCase } from "@/portal/cases";
import { personDocs, personsOf } from "@/portal/company";
import { removePersonAction } from "../actions";
import { ConfirmPersonsForm, PersonForm } from "../_forms/company-forms";
import { requireStep } from "../session";

// Representative, UBOs, shareholders and board members (spec 03). KYC is done on each of them.
export default async function PersonsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
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
  const sc = stepCase(c);

  return (
    <ApplicantShell
      panelTitle="The people involved"
      panelBody="We verify everyone who represents, owns or directs the company. One person can have several roles."
      c={sc}
      current="persons"
      title="People involved"
      lede="You, the ultimate beneficial owner(s), all shareholders and all board members."
    >
      {!me || editing?.isApplicant ? (
        <section className="stack">
          <h2 className="section-title">About you</h2>
          <PersonForm {...formProps} isApplicant saved={me ?? { fullName: `${applicant.firstName} ${applicant.lastName}` }} personId={me?.id} onFile={{}} />
        </section>
      ) : (
        <>
          <div className="table-scroll">
            <table className="tbl" style={{ minWidth: 520 }}>
              <thead><tr><th>Name</th><th>Roles</th><th>Documents</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {persons.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">{p.fullName}{p.isApplicant && " (you)"}<span className="sub">{countryName(p.countryOfResidence)}</span></th>
                    <td>{(p.roles as string[]).map(roleLabel).join(", ")}{p.sharePercent && ` · ${p.sharePercent}%`}</td>
                    <td>
                      {p.isApplicant ? (
                        <span className="muted">In the next steps</span>
                      ) : (
                        <>
                          {fileOf(p.id, "person_poi") ? <Ticked>ID</Ticked> : <span className="chip flag">ID missing</span>}{" "}
                          {fileOf(p.id, "person_por") ? <Ticked>Address</Ticked> : <span className="chip flag">Address missing</span>}
                        </>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Link href={`/apply/persons?edit=${p.id}`} className="link">Edit</Link>
                      {!p.isApplicant && (
                        <form action={removePersonAction} style={{ display: "inline", marginLeft: 12 }}>
                          <input type="hidden" name="personId" value={p.id} />
                          <button type="submit" className="link-btn">Remove</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalShares > 0 && totalShares !== deps.kyb.shareholding_total_percent && (
            <div className="banner">Declared shareholdings add up to {totalShares}%. Please list every shareholder, so they add up to {deps.kyb.shareholding_total_percent}%.</div>
          )}
          <section className="stack divider">
            <h2 className="section-title">{editing ? `Edit ${editing.fullName}` : "Add a person"}</h2>
            <PersonForm
              key={editing?.id ?? "new"}
              {...formProps}
              isApplicant={false}
              personId={editing?.id}
              saved={editing ?? null}
              onFile={editing ? { poi: fileOf(editing.id, "person_poi"), por: fileOf(editing.id, "person_por") } : {}}
            />
            {editing && <p><Link href="/apply/persons" className="link">Cancel editing</Link></p>}
          </section>
          <section className="stack divider">
            <h2 className="section-title">Done?</h2>
            <ConfirmPersonsForm back={backPath("persons", sc)} />
          </section>
        </>
      )}
    </ApplicantShell>
  );
}
