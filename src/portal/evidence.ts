import type { EvidenceLevelId, WalletConfig } from "@/wallet/config";
import type { WalletEvidence } from "@/wallet/types";
import type { IdentityData } from "./cases";

// The evidence-assurance ladder (docs/spec/09 section 4). The level is derived here from stored evidence,
// never typed in by a person and never an engine input (D17, O-75).

export const walletEvidenceOf = (identity: IdentityData | null | undefined): WalletEvidence | undefined =>
  identity?.evidence?.source === "wallet" ? identity.evidence : undefined;

export function evidenceLevelOf(identity: IdentityData | null | undefined): EvidenceLevelId | null {
  if (!identity?.complete) return null;
  if (walletEvidenceOf(identity)) return "wallet_pid";
  return identity.selfie === "passed" ? "document_selfie" : "document_selfie_flagged";
}

export const levelConfig = (cfg: WalletConfig, id: EvidenceLevelId) => cfg.evidence_levels.find((l) => l.id === id)!;

/** Spec 05: the EDD "photo holding your ID" is skipped when the identity evidence already covers it. */
export function satisfiesExtraKyc(identity: IdentityData | null | undefined, cfg: WalletConfig): boolean {
  const id = evidenceLevelOf(identity);
  return id ? levelConfig(cfg, id).satisfies_extra_kyc : false;
}

/** Identity proven strongly enough to say "identity verified" in the console. */
export const identityVerified = (identity: IdentityData | null | undefined) => evidenceLevelOf(identity) === "wallet_pid" || identity?.selfie === "passed";

/** Date of birth and nationalities the wallet attested; the questionnaire shows them read-only. */
export function lockedFromWallet(identity: IdentityData | null | undefined): { birthDate: string; nationalities: string[] } | null {
  const a = walletEvidenceOf(identity)?.attributes;
  return a ? { birthDate: a.birthDate, nationalities: a.nationalities } : null;
}

/** Residence form pre-fill from the PID address, when it carried one. Still editable (O-71). */
export function residencePrefill(identity: IdentityData | null | undefined): Record<string, string> | null {
  const a = walletEvidenceOf(identity)?.attributes.address;
  if (!a) return null;
  const fields = {
    addressLine1: [a.streetAddress, a.houseNumber].filter(Boolean).join(" "),
    city: a.locality,
    region: a.region,
    postcode: a.postalCode,
    country: a.country,
  };
  const filled = Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) as Record<string, string>;
  return Object.keys(filled).length ? filled : null;
}
