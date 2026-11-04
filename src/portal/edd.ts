import { eq } from "drizzle-orm";
import { cases } from "@/db/schema";
import { audit } from "@/lib/audit";
import { appendRecord } from "@/records/store";
import type { EddRequest } from "@/console/actions";
import { checkUpload, storeDoc, type CaseRow, type UploadInput } from "./cases";
import type { PortalDeps } from "./deps";
import { PortalError, type FieldErrors } from "./errors";

export type EddSubmission = { submittedAt: string; note: string | null; sofDocuments: number; extraKyc: boolean };

/** Applicant answers an EDD request (spec 05): proof of source of funds, plus extra KYC if asked. */
export async function submitEdd(deps: PortalDeps, c: CaseRow, input: { note?: string }, files: { sof: UploadInput[]; eddKyc?: UploadInput }) {
  if (c.status !== "edd_requested") throw new PortalError("NOT_EDITABLE", "There is nothing to send for your application right now.");
  const request = c.eddRequest as EddRequest;
  const errors: FieldErrors = {};
  const mimes = deps.portal.uploads.document_mime;
  const sof = files.sof.filter((f) => f.size > 0);
  sof.forEach((f) => checkUpload(deps, "sof", f, mimes, errors));
  if (!sof.length) errors.sof = ["Upload at least one document showing your source of funds"];
  const kyc = checkUpload(deps, "eddKyc", files.eddKyc, deps.portal.uploads.selfie_mime, errors);
  if (request.items.extraKyc === "required" && !kyc) errors.eddKyc ??= ["Upload a photo of yourself holding your identity document"];
  if (Object.keys(errors).length) throw new PortalError("VALIDATION", "Please check the highlighted fields.", errors);

  for (const f of sof) await storeDoc(deps, c, "sof", f, null, { keepPrevious: true });
  if (kyc) await storeDoc(deps, c, "edd_kyc", kyc, null);
  const submission: EddSubmission = { submittedAt: deps.now().toISOString(), note: input.note?.trim() || null, sofDocuments: sof.length, extraKyc: !!kyc };
  deps.db.update(cases).set({ status: "edd_submitted", eddSubmission: submission, updatedAt: deps.now().toISOString() }).where(eq(cases.id, c.id)).run();
  appendRecord(deps, { subject: c.id, kind: "applicant.edd_submitted", policy: deps.policies.inForce(deps.now().toISOString()), inputs: { type: "status", status_from: c.status }, decided_by: "applicant" });
  audit(deps.db, deps.now(), `applicant:${c.applicantId}`, "edd.submitted", `case:${c.id}`, { sofDocuments: sof.length, extraKyc: !!kyc });
}
