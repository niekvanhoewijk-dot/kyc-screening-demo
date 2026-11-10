import { demoSampleInfo, demoSubject, identityOf, residenceOf, withResidenceExtras } from "@/demo/prefill";
import { COUNTRIES } from "@/lib/countries";
import type { CaseRow, IdentityData } from "@/portal/cases";
import type { PortalDeps } from "@/portal/deps";
import { residencePrefill, walletEvidenceOf } from "@/portal/evidence";
import { onFileNames } from "../on-file";

// Props for the identity and residence forms, built once for the step pages and the interviewer's inline cards.
// With Demo Mode on (spec 11) they also carry the persona's values and the sample documents that attach themselves.

export function identityFormProps(deps: PortalDeps, c: CaseRow) {
  const saved = c.identity as IdentityData | null;
  const files = onFileNames(deps, c.id);
  const demo = demoSubject(deps, c.applicantId);
  return {
    docTypes: deps.portal.poi.document_types,
    countries: [...COUNTRIES],
    saved: walletEvidenceOf(saved) ? null : (saved ?? (demo ? identityOf(demo.rep) : null)),
    samples: { front: demoSampleInfo(deps, c, "front"), selfie: demoSampleInfo(deps, c, "selfie") },
    onFile: { front: files.poi_front, back: files.poi_back, selfie: files.selfie },
    documentAccept: deps.portal.uploads.document_mime.join(","),
    selfieAccept: deps.portal.uploads.selfie_mime.join(","),
    selfieRetry: saved?.selfie === "retry",
  };
}

export function residenceFormProps(deps: PortalDeps, c: CaseRow) {
  // From the ID wallet, if it carried an address and nothing is saved yet (O-71: still editable, proof still needed).
  const prefill = c.residence ? null : residencePrefill(c.identity as IdentityData | null);
  const demo = demoSubject(deps, c.applicantId);
  return {
    prefilled: prefill !== null,
    form: {
      porTypes: deps.portal.por.document_types,
      countries: [...COUNTRIES],
      saved: (c.residence as Record<string, unknown> | null) ?? (prefill && demo ? withResidenceExtras(prefill) : prefill) ?? (demo ? residenceOf(demo.rep) : null),
      sample: demoSampleInfo(deps, c, "por"),
      onFile: onFileNames(deps, c.id).por,
      documentAccept: deps.portal.uploads.document_mime.join(","),
      maxAgeMonths: deps.portal.por.max_age_months,
    },
  };
}
