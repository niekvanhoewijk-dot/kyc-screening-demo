import type { TrustedIssuer } from "./config";

/** What we keep of a verified PID. Only requested attributes are stored (data minimisation). */
export type PidAddress = { streetAddress?: string; houseNumber?: string; locality?: string; region?: string; postalCode?: string; country?: string };

export type PidAttributes = {
  givenName: string;
  familyName: string;
  /** Full ISO date (YYYY-MM-DD). */
  birthDate: string;
  nationalities: string[];
  address?: PidAddress;
  /** Administrative expiry of the PID, when the issuer supplied it. */
  documentExpiry?: string;
  issuingCountry?: string;
};

/** Stored on `cases.identity.evidence` after a successful presentation. Never holds the raw token or the holder key. */
export type WalletEvidence = {
  source: "wallet";
  sessionId: string;
  verifiedAt: string;
  issuer: Pick<TrustedIssuer, "iss" | "name" | "country">;
  credentialType: string;
  credentialExpiresAt: string;
  presentationSha256: string;
  attributes: PidAttributes;
  /** Names of the checks that passed, for the analyst. */
  checks: string[];
  /** Disclosed claims we did not ask for. Names only; the values are dropped. */
  ignoredClaims: string[];
};

/** OpenID4VP-style request (response_mode direct_post, DCQL query). */
export type WalletRequest = {
  sessionId: string;
  client_id: string;
  response_type: "vp_token";
  response_mode: "direct_post";
  nonce: string;
  state: string;
  expiresAt: string;
  dcql_query: {
    credentials: { id: "pid"; format: "dc+sd-jwt"; meta: { vct_values: string[] }; claims: { path: string[] }[] }[];
  };
};
