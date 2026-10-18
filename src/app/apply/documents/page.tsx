import { Stepper } from "@/components/stepper";
import { uploadableItems } from "@/engine";
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
  return (
    <div className="card">
      <Stepper current="documents" c={stepCase(c)} />
      <h1>Company documents</h1>
      <p className="lede">Upload what you have. Certified copies where the document says so. You can come back to add more until you submit.</p>
      {missing > 0 && <div className="banner info">{missing} of {items.length} documents not uploaded yet. You can still continue; we&apos;ll ask for anything missing.</div>}
      <CompanyDocumentsForm items={items} unsorted={docs.filter((d) => !d.docType).map((d) => d.originalName)} documentAccept={deps.portal.uploads.document_mime.join(",")} />
    </div>
  );
}
