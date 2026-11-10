import { ApplicantShell, backPath } from "@/components/applicant-shell";
import { uploadableItems } from "@/engine";
import { demoCompanyDocuments } from "@/demo/prefill";
import { stepCase } from "@/portal/cases";
import { companyDocuments } from "@/portal/company";
import { CompanyDocumentsForm } from "../_forms/company-forms";
import { requireStep } from "../session";

// Company document pack (spec 03 items 3-13). Missing items don't block submission; the analyst sees a gap list.
export default async function CompanyDocumentsPage() {
  const { deps, c } = await requireStep("documents");
  const docs = companyDocuments(deps, c.id);
  const items = uploadableItems(deps.kyb).map((i) => ({ ...i, uploaded: docs.filter((d) => d.docType === i.id).map((d) => d.originalName) }));
  const missing = items.filter((i) => i.uploaded.length === 0).length;
  const sc = stepCase(c);
  const samples = Object.fromEntries(Object.entries(demoCompanyDocuments(deps, c)).map(([item, files]) => [item, files[0]!.name]));
  return (
    <ApplicantShell
      panelTitle="Company documents"
      panelBody="Upload what you have, certified where the document says so. You can come back to add more until you submit."
      c={sc}
      current="documents"
      title="Company documents"
      lede={missing > 0 ? `${missing} of ${items.length} documents not uploaded yet. You can still continue; we'll ask for anything missing.` : `All ${items.length} documents uploaded.`}
    >
      <CompanyDocumentsForm items={items} unsorted={docs.filter((d) => !d.docType).map((d) => d.originalName)} documentAccept={deps.portal.uploads.document_mime.join(",")} back={backPath("documents", sc)} samples={samples} />
    </ApplicantShell>
  );
}
