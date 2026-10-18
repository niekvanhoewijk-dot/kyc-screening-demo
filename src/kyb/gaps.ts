import { namesMatch } from "@/documents/checks";
import type { KybClassification } from "@/documents/kyb-schemas";
import type { ReasonCode } from "@/documents/reason-codes";
import { uploadableItems, type KybConfig } from "@/engine";

// KYB gap list (spec 03 "Claude's role" 3-4). Pure code over declared data and, in MVP 2, Claude's
// classifications. Claude classifies and extracts; this code decides what is missing.

export type Gap = {
  code: ReasonCode | null;
  severity: "missing" | "inconsistent";
  detail: string;
  source: "declared" | "claude";
  item?: string;
  personId?: string;
};

export type GapInput = {
  company: { legalName: string; registrationNumber: string };
  persons: { id: string; fullName: string; roles: string[]; sharePercent: number | null; isApplicant: boolean; hasPoi: boolean; hasPor: boolean }[];
  /** The representative's own POI and POR come from the individual steps. */
  applicantDocs: { poi: boolean; por: boolean };
  docs: { id: string; name: string; tag: string | null; classification: KybClassification | null }[];
};

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Document-level checks on one classification (also used by the eval on single documents). */
export function documentGaps(doc: GapInput["docs"][number], input: Pick<GapInput, "company" | "persons">, kyb: KybConfig): Gap[] {
  const x = doc.classification;
  if (!x) return [];
  const gaps: Gap[] = [];
  const label = (id: string) => uploadableItems(kyb).find((i) => i.id === id)?.label ?? id;

  if (x.document_type === "unrecognised") gaps.push({ code: null, severity: "inconsistent", detail: `"${doc.name}" was not recognised as a company document.`, source: "claude" });
  else if (doc.tag && doc.tag !== x.document_type)
    gaps.push({ code: null, severity: "inconsistent", detail: `"${doc.name}" was uploaded as "${label(doc.tag)}" but reads as "${label(x.document_type)}".`, source: "claude", item: doc.tag });

  if (x.company_name && !namesMatch(input.company.legalName, x.company_name))
    gaps.push({ code: "NAME_MISMATCH", severity: "inconsistent", detail: `"${doc.name}" names the company "${x.company_name}", declared "${input.company.legalName}".`, source: "claude" });
  const norm = (s: string) => s.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (x.registration_number && norm(x.registration_number) !== norm(input.company.registrationNumber))
    gaps.push({ code: "NAME_MISMATCH", severity: "inconsistent", detail: `"${doc.name}" shows registration number ${x.registration_number}, declared ${input.company.registrationNumber}.`, source: "claude" });

  // Everyone named in ownership or board documents must be on the KYC list (spec 03).
  for (const p of x.persons) {
    const match = input.persons.find((d) => namesMatch(d.fullName, p.name) || namesMatch(p.name, d.fullName));
    if (!match) gaps.push({ code: "KYB_PERSON_WITHOUT_KYC", severity: "missing", detail: `${p.name} (${p.role}) appears in "${doc.name}" but is not on the KYC list.`, source: "claude" });
    else if (p.role === "shareholder" && p.share_percent !== null && match.sharePercent !== null && !close(p.share_percent, match.sharePercent))
      gaps.push({ code: null, severity: "inconsistent", detail: `${p.name}: ${p.share_percent}% in "${doc.name}", declared ${match.sharePercent}%.`, source: "claude", personId: match.id });
  }

  const shares = x.persons.filter((p) => p.role === "shareholder" && p.share_percent !== null).map((p) => p.share_percent!);
  if (shares.length && !close(shares.reduce((a, b) => a + b, 0), kyb.shareholding_total_percent))
    gaps.push({ code: "KYB_SHAREHOLDING_NOT_100", severity: "inconsistent", detail: `Shareholdings in "${doc.name}" add up to ${shares.reduce((a, b) => a + b, 0)}%, not ${kyb.shareholding_total_percent}%.`, source: "claude" });
  return gaps;
}

export function gapList(input: GapInput, kyb: KybConfig): Gap[] {
  const gaps: Gap[] = [];

  // Documents: an item is covered if the applicant tagged a file for it, or Claude classified one as it.
  for (const item of uploadableItems(kyb)) {
    const covered = input.docs.some((d) => d.tag === item.id || d.classification?.document_type === item.id);
    if (!covered) gaps.push({ code: "KYB_DOCUMENT_MISSING", severity: "missing", detail: `Missing: ${item.item}. ${item.label}.`, source: "declared", item: item.id });
  }

  // People: required roles, and POI + POR for each natural person (items 1-2).
  for (const role of kyb.required_roles)
    if (!input.persons.some((p) => p.roles.includes(role)))
      gaps.push({ code: "KYB_PERSON_WITHOUT_KYC", severity: "missing", detail: `No ${kyb.person_roles.find((r) => r.id === role)?.label ?? role} listed.`, source: "declared" });
  for (const p of input.persons) {
    const poi = p.isApplicant ? input.applicantDocs.poi : p.hasPoi;
    const por = p.isApplicant ? input.applicantDocs.por : p.hasPor;
    const missing = [!poi && "ID", !por && "proof of residence"].filter(Boolean);
    if (missing.length) gaps.push({ code: "KYB_PERSON_WITHOUT_KYC", severity: "missing", detail: `${p.fullName}: ${missing.join(" and ")} missing.`, source: "declared", personId: p.id });
  }

  const declaredShares = input.persons.filter((p) => p.roles.includes("shareholder") && p.sharePercent !== null);
  const total = declaredShares.reduce((n, p) => n + p.sharePercent!, 0);
  if (!declaredShares.length) gaps.push({ code: "KYB_PERSON_WITHOUT_KYC", severity: "missing", detail: "No shareholders listed.", source: "declared" });
  else if (!close(total, kyb.shareholding_total_percent))
    gaps.push({ code: "KYB_SHAREHOLDING_NOT_100", severity: "inconsistent", detail: `Declared shareholdings add up to ${total}%, not ${kyb.shareholding_total_percent}%.`, source: "declared" });

  for (const d of input.docs) gaps.push(...documentGaps(d, input, kyb));
  return gaps;
}
