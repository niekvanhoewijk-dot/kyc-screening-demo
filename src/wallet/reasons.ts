// Why a wallet presentation was rejected (docs/spec/09 section 6). Audited for the analyst; never shown
// to the applicant (D7). Not produced by Claude, so separate from src/documents/reason-codes.ts.

export const WALLET_REJECT_CODES = [
  "WALLET_TOKEN_MALFORMED",
  "WALLET_ISSUER_NOT_TRUSTED",
  "WALLET_SIGNATURE_INVALID",
  "WALLET_WRONG_CREDENTIAL_TYPE",
  "WALLET_CREDENTIAL_EXPIRED",
  "WALLET_DISCLOSURE_INVALID",
  "WALLET_KEY_BINDING_MISSING",
  "WALLET_KEY_BINDING_INVALID",
  "WALLET_NONCE_MISMATCH",
  "WALLET_AUDIENCE_MISMATCH",
  "WALLET_PRESENTATION_STALE",
  "WALLET_ATTRIBUTE_MISSING",
  "WALLET_ATTRIBUTE_INVALID",
  "WALLET_DOCUMENT_EXPIRED",
  "WALLET_SESSION_INVALID",
] as const;

export type WalletRejectCode = (typeof WALLET_REJECT_CODES)[number];

export class WalletRejection extends Error {
  constructor(
    readonly code: WalletRejectCode,
    readonly detail = "",
  ) {
    super(`${code}${detail ? `: ${detail}` : ""}`);
  }
}
