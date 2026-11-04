export type PortalErrorCode =
  | "VALIDATION"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "OTP_LOCKED"
  | "OTP_COOLDOWN"
  | "POI_EXPIRED"
  | "SELFIE_RETRY"
  | "UPLOAD_REJECTED"
  | "STEP_LOCKED"
  | "NOT_EDITABLE"
  | "NOT_FOUND"
  | "WALLET_FAILED";

export type FieldErrors = Record<string, string[] | undefined>;

/**
 * An error the applicant may see. Messages never reveal screening, PEP, watchlist or
 * risk-score reasons (D7, no tipping off).
 */
export class PortalError extends Error {
  constructor(
    readonly code: PortalErrorCode,
    message: string,
    readonly fieldErrors: FieldErrors = {},
  ) {
    super(message);
  }
}
