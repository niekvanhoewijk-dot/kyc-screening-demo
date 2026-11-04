import { isCountryCode } from "@/lib/countries";
import type { WalletConfig } from "./config";
import { WalletRejection } from "./reasons";
import type { PidAddress, PidAttributes } from "./types";

// Turns the verified claims of a PID into the attributes we keep. Names of the claims come from config (O-69).

type Json = Record<string, unknown>;

const REGISTERED = new Set(["iss", "iat", "exp", "nbf", "jti", "sub", "vct", "vct#integrity", "cnf", "status", "verification"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s: string) => ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, "yyyy-mm-dd".length) === s;
const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

export function extractPid(claims: Json, cfg: WalletConfig, today: string): { attributes: PidAttributes; ignoredClaims: string[]; checks: string[] } {
  const req = cfg.request.required_claims;
  const opt = cfg.request.optional_claims;

  const missing = [req.given_name, req.family_name, req.birth_date, req.nationalities].filter((name) => claims[name] === undefined);
  if (missing.length) throw new WalletRejection("WALLET_ATTRIBUTE_MISSING", missing.join(", "));

  const givenName = text(claims[req.given_name]);
  const familyName = text(claims[req.family_name]);
  const birthDate = text(claims[req.birth_date]);
  if (!givenName || !familyName) throw new WalletRejection("WALLET_ATTRIBUTE_INVALID", "name");
  if (!birthDate || !isRealDate(birthDate) || birthDate >= today) throw new WalletRejection("WALLET_ATTRIBUTE_INVALID", "birth date");
  const rawNationalities = claims[req.nationalities];
  const nationalities = Array.isArray(rawNationalities) ? [...new Set(rawNationalities.filter((n): n is string => typeof n === "string" && isCountryCode(n)))] : [];
  if (!nationalities.length) throw new WalletRejection("WALLET_ATTRIBUTE_INVALID", "nationalities");

  const attributes: PidAttributes = { givenName, familyName, birthDate, nationalities };

  const rawAddress = claims[opt.address];
  if (rawAddress !== undefined && typeof rawAddress === "object" && rawAddress !== null && !Array.isArray(rawAddress)) {
    const a = rawAddress as Json;
    const country = text(a.country);
    const address: PidAddress = {
      streetAddress: text(a.street_address),
      houseNumber: text(a.house_number),
      locality: text(a.locality),
      region: text(a.region),
      postalCode: text(a.postal_code),
      country: country && isCountryCode(country) ? country : undefined,
    };
    attributes.address = Object.fromEntries(Object.entries(address).filter(([, v]) => v !== undefined)) as PidAddress;
  }
  const issuingCountry = text(claims[opt.issuing_country]);
  if (issuingCountry && isCountryCode(issuingCountry)) attributes.issuingCountry = issuingCountry;

  const expiry = claims[opt.document_expiry];
  if (expiry !== undefined) {
    const e = text(expiry);
    if (!e || !isRealDate(e)) throw new WalletRejection("WALLET_ATTRIBUTE_INVALID", "document expiry");
    if (e < today) throw new WalletRejection("WALLET_DOCUMENT_EXPIRED", e);
    attributes.documentExpiry = e;
  }

  // Data minimisation: whatever else the holder disclosed is dropped; only the names are kept for the audit trail.
  const asked = new Set<string>([...Object.values(req), ...Object.values(opt)]);
  const ignoredClaims = Object.keys(claims).filter((k) => !asked.has(k) && !REGISTERED.has(k));
  return { attributes, ignoredClaims, checks: ["required_attributes", ...(attributes.documentExpiry ? ["document_in_date"] : [])] };
}
