import crypto, { type KeyObject } from "node:crypto";
import { sha256 } from "@/lib/ids";
import type { Jwk, TrustedIssuer } from "./config";
import { WalletRejection, type WalletRejectCode } from "./reasons";

// SD-JWT (RFC 9901) and SD-JWT VC with node:crypto only: ES256 = ECDSA P-256 + SHA-256, JWS signatures in
// IEEE P1363 form. The issuer and holder halves exist for the built-in test ecosystem; the verifier is
// what a relying party runs. docs/spec/09 section 6 lists every check and its failure code.

type Json = Record<string, unknown>;

const B64URL = /^[A-Za-z0-9_-]+$/;
const encodeJson = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
export const digestOf = (encoded: string) => crypto.createHash("sha256").update(encoded).digest("base64url");
const isPlain = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const reject = (code: WalletRejectCode, detail?: string) => new WalletRejection(code, detail);

// --- keys and compact JWS ---------------------------------------------------------------------

export const newEcKeyPair = () => crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });

export function jwkOf(publicKey: KeyObject): Jwk {
  const j = publicKey.export({ format: "jwk" });
  return { kty: "EC", crv: "P-256", x: String(j.x), y: String(j.y) };
}

export const publicKeyFromJwk = (jwk: unknown): KeyObject => {
  if (!isPlain(jwk) || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string") throw new Error("not an EC P-256 public JWK");
  return crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
};

export function signJwt(header: Json, payload: Json, privateKey: KeyObject): string {
  const input = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = crypto.sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${input}.${signature.toString("base64url")}`;
}

type DecodedJwt = { header: Json; payload: Json; signingInput: string; signature: Buffer };

function decodeJwt(compact: string): DecodedJwt {
  const parts = compact.split(".");
  if (parts.length !== 3 || parts.some((p) => !B64URL.test(p))) throw reject("WALLET_TOKEN_MALFORMED", "not a compact JWT");
  const [h, p, s] = parts as [string, string, string];
  try {
    const header: unknown = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    const payload: unknown = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (!isPlain(header) || !isPlain(payload)) throw new Error("not objects");
    return { header, payload, signingInput: `${h}.${p}`, signature: Buffer.from(s, "base64url") };
  } catch {
    throw reject("WALLET_TOKEN_MALFORMED", "JWT header or payload is not JSON");
  }
}

function signatureValid(jwt: DecodedJwt, publicKey: KeyObject): boolean {
  try {
    return crypto.verify("sha256", Buffer.from(jwt.signingInput), { key: publicKey, dsaEncoding: "ieee-p1363" }, jwt.signature);
  } catch {
    return false;
  }
}

// --- issuer and holder halves (test ecosystem and tests) -----------------------------------------

export type Disclosure = { encoded: string; salt: string; name?: string; value: unknown };

/** An object-property disclosure when `name` is given, an array-element disclosure otherwise. */
export function makeDisclosure(name: string | undefined, value: unknown, salt = crypto.randomBytes(16).toString("base64url")): Disclosure {
  return { encoded: encodeJson(name === undefined ? [salt, value] : [salt, name, value]), salt, name, value };
}

/** Signs a credential whose `selective` claims sit behind disclosures. Digests are sorted so their order leaks nothing. */
export function issueSdJwt(args: { header: Json; payload: Json; selective: Record<string, unknown>; issuerKey: KeyObject }): { issuerJwt: string; disclosures: Disclosure[] } {
  const disclosures = Object.entries(args.selective).map(([name, value]) => makeDisclosure(name, value));
  const payload = { ...args.payload, _sd: disclosures.map((d) => digestOf(d.encoded)).sort(), _sd_alg: "sha-256" };
  return { issuerJwt: signJwt(args.header, payload, args.issuerKey), disclosures };
}

/** issuer JWT ~ chosen disclosures ~ [key binding JWT]. Without `keyBinding` the token ends in "~". */
export function buildPresentation(args: {
  issuerJwt: string;
  disclosures: Disclosure[];
  keyBinding?: { key: KeyObject; typ: string; aud: string; nonce: string; iat: number };
}): string {
  const signed = `${[args.issuerJwt, ...args.disclosures.map((d) => d.encoded)].join("~")}~`;
  if (!args.keyBinding) return signed;
  const { key, typ, aud, nonce, iat } = args.keyBinding;
  return signed + signJwt({ alg: "ES256", typ }, { iat, aud, nonce, sd_hash: digestOf(signed) }, key);
}

// --- verifier --------------------------------------------------------------------------------

export type SdJwtVerifyOptions = {
  trust: TrustedIssuer[];
  expectedVct: string;
  audience: string;
  nonce: string;
  nowSeconds: number;
  clockSkewSeconds: number;
  maxPresentationAgeSeconds: number;
  allowedAlgs: string[];
  allowedCredentialTyp: string[];
  keyBindingTyp: string;
  maxTokenBytes: number;
  maxDisclosures: number;
  maxClaimDepth: number;
};

export type VerifiedSdJwt = {
  issuer: TrustedIssuer;
  /** Reconstructed claims with disclosures applied. `cnf`, `_sd` and `_sd_alg` are removed. */
  claims: Json;
  credentialExpiresAt: number;
  checks: string[];
  presentationSha256: string;
};

type Parsed = { name?: string; value: unknown };

function parseDisclosure(encoded: string): Parsed {
  if (!B64URL.test(encoded)) throw reject("WALLET_DISCLOSURE_INVALID", "not base64url");
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw reject("WALLET_DISCLOSURE_INVALID", "not JSON");
  }
  if (!Array.isArray(decoded) || (decoded.length !== 2 && decoded.length !== 3) || typeof decoded[0] !== "string") throw reject("WALLET_DISCLOSURE_INVALID", "wrong shape");
  if (decoded.length === 2) return { value: decoded[1] };
  const name = decoded[1];
  if (typeof name !== "string" || name === "" || name === "_sd" || name === "...") throw reject("WALLET_DISCLOSURE_INVALID", "reserved or empty claim name");
  return { name, value: decoded[2] };
}

/** RFC 9901 section 7.1: put each disclosure back where its digest sits; every disclosure must be used exactly once. */
function reconstruct(payload: Json, strings: string[], maxDepth: number): Json {
  const byDigest = new Map<string, Parsed>();
  for (const s of strings) {
    const digest = digestOf(s);
    if (byDigest.has(digest)) throw reject("WALLET_DISCLOSURE_INVALID", "duplicate disclosure");
    byDigest.set(digest, parseDisclosure(s));
  }
  const used = new Set<string>();
  const take = (digest: string): Parsed | undefined => {
    const found = byDigest.get(digest);
    if (!found) return undefined; // a decoy digest
    if (used.has(digest)) throw reject("WALLET_DISCLOSURE_INVALID", "digest referenced twice");
    used.add(digest);
    return found;
  };
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > maxDepth) throw reject("WALLET_DISCLOSURE_INVALID", "claims nested too deeply");
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      for (const el of node) {
        if (isPlain(el) && Object.keys(el).length === 1 && "..." in el) {
          const digest = el["..."];
          if (typeof digest !== "string") throw reject("WALLET_DISCLOSURE_INVALID", "array digest is not a string");
          const d = take(digest);
          if (!d) continue;
          if (d.name !== undefined) throw reject("WALLET_DISCLOSURE_INVALID", "object disclosure used in an array");
          out.push(walk(d.value, depth + 1));
        } else out.push(walk(el, depth + 1));
      }
      return out;
    }
    if (!isPlain(node)) return node;
    const entries: [string, unknown][] = [];
    const names = new Set<string>();
    for (const [k, v] of Object.entries(node)) {
      if (k === "_sd" || (k === "_sd_alg" && depth === 0)) continue;
      names.add(k);
      entries.push([k, walk(v, depth + 1)]);
    }
    const sd = node["_sd"];
    if (sd !== undefined) {
      if (!Array.isArray(sd) || sd.some((x) => typeof x !== "string")) throw reject("WALLET_DISCLOSURE_INVALID", "_sd is not a list of digests");
      for (const digest of sd as string[]) {
        const d = take(digest);
        if (!d) continue;
        if (d.name === undefined) throw reject("WALLET_DISCLOSURE_INVALID", "array disclosure used in an object");
        if (names.has(d.name)) throw reject("WALLET_DISCLOSURE_INVALID", "claim name collision");
        names.add(d.name);
        entries.push([d.name, walk(d.value, depth + 1)]);
      }
    }
    return Object.fromEntries(entries);
  };
  const result = walk(payload, 0) as Json;
  if (used.size !== byDigest.size) throw reject("WALLET_DISCLOSURE_INVALID", "a disclosure is not referenced by the signed payload");
  return result;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Verifies an SD-JWT VC presentation with key binding. Throws WalletRejection at the first failing check. */
export function verifySdJwtPresentation(token: string, o: SdJwtVerifyOptions): VerifiedSdJwt {
  const checks: string[] = [];
  const skew = o.clockSkewSeconds;

  // 1. Shape and size.
  if (typeof token !== "string" || token === "" || Buffer.byteLength(token) > o.maxTokenBytes) throw reject("WALLET_TOKEN_MALFORMED", "empty or too large");
  const parts = token.split("~");
  if (parts.length < 2) throw reject("WALLET_TOKEN_MALFORMED", "no disclosure separator");
  const issuerJwt = parts[0] as string;
  const keyBindingJwt = parts[parts.length - 1] as string; // "" when the holder sent no key binding
  const disclosureStrings = parts.slice(1, -1);
  if (disclosureStrings.length > o.maxDisclosures) throw reject("WALLET_TOKEN_MALFORMED", "too many disclosures");
  if (disclosureStrings.some((d) => d === "")) throw reject("WALLET_TOKEN_MALFORMED", "empty disclosure");
  const issuer = decodeJwt(issuerJwt);

  // 2. Header: algorithm and type from the allow-lists only.
  if (typeof issuer.header.alg !== "string" || !o.allowedAlgs.includes(issuer.header.alg)) throw reject("WALLET_TOKEN_MALFORMED", "algorithm not allowed");
  if (typeof issuer.header.typ !== "string" || !o.allowedCredentialTyp.includes(issuer.header.typ)) throw reject("WALLET_TOKEN_MALFORMED", "credential typ not allowed");

  // 3. Issuer in the trust list. Keys come from the list, never from the token (jwk, jku, x5u are ignored).
  const iss = issuer.payload.iss;
  if (typeof iss !== "string") throw reject("WALLET_TOKEN_MALFORMED", "iss missing");
  const kid = issuer.header.kid;
  const candidates = o.trust.filter((t) => t.iss === iss && (typeof kid !== "string" || t.kid === kid));
  if (!candidates.length) throw reject("WALLET_ISSUER_NOT_TRUSTED", iss);
  checks.push("issuer_trusted");

  // 4. Issuer signature.
  const signer = candidates.find((t) => signatureValid(issuer, publicKeyFromJwk(t.jwk)));
  if (!signer) throw reject("WALLET_SIGNATURE_INVALID");
  checks.push("issuer_signature");

  // 5. Credential type.
  if (issuer.payload.vct !== o.expectedVct) throw reject("WALLET_WRONG_CREDENTIAL_TYPE", String(issuer.payload.vct));
  checks.push("credential_type");

  // 6. Validity window.
  const exp = num(issuer.payload.exp);
  if (exp === undefined) throw reject("WALLET_CREDENTIAL_EXPIRED", "exp missing");
  if (o.nowSeconds > exp + skew) throw reject("WALLET_CREDENTIAL_EXPIRED", "expired");
  for (const claim of ["nbf", "iat"] as const) {
    if (issuer.payload[claim] === undefined) continue;
    const at = num(issuer.payload[claim]);
    if (at === undefined) throw reject("WALLET_TOKEN_MALFORMED", `${claim} is not a number`);
    if (at > o.nowSeconds + skew) throw reject("WALLET_CREDENTIAL_EXPIRED", `${claim} is in the future`);
  }
  checks.push("credential_validity");

  // 7. Selective disclosure.
  if (issuer.payload._sd_alg !== undefined && issuer.payload._sd_alg !== "sha-256") throw reject("WALLET_DISCLOSURE_INVALID", "digest algorithm not supported");
  const claims = reconstruct(issuer.payload, disclosureStrings, o.maxClaimDepth);
  checks.push("selective_disclosure");

  // 8. Key binding present.
  if (keyBindingJwt === "") throw reject("WALLET_KEY_BINDING_MISSING");

  // 9. Key binding signed by the credential's own key, over exactly this presentation.
  let holderKey: KeyObject;
  try {
    holderKey = publicKeyFromJwk((issuer.payload.cnf as Json | undefined)?.jwk);
  } catch {
    throw reject("WALLET_KEY_BINDING_INVALID", "credential has no usable cnf key");
  }
  let kb: DecodedJwt;
  try {
    kb = decodeJwt(keyBindingJwt);
  } catch {
    throw reject("WALLET_KEY_BINDING_INVALID", "malformed key binding JWT");
  }
  if (kb.header.typ !== o.keyBindingTyp || typeof kb.header.alg !== "string" || !o.allowedAlgs.includes(kb.header.alg)) throw reject("WALLET_KEY_BINDING_INVALID", "header");
  if (!signatureValid(kb, holderKey)) throw reject("WALLET_KEY_BINDING_INVALID", "signature");
  const signedPart = `${parts.slice(0, -1).join("~")}~`;
  if (typeof kb.payload.sd_hash !== "string" || !safeEqual(kb.payload.sd_hash, digestOf(signedPart))) throw reject("WALLET_KEY_BINDING_INVALID", "sd_hash");
  checks.push("key_binding");

  // 10. Nonce: this session, once.
  if (typeof kb.payload.nonce !== "string" || !safeEqual(kb.payload.nonce, o.nonce)) throw reject("WALLET_NONCE_MISMATCH");
  checks.push("nonce");

  // 11. Audience: this relying party.
  if (kb.payload.aud !== o.audience) throw reject("WALLET_AUDIENCE_MISMATCH");
  checks.push("audience");

  // 12. Freshness of the presentation itself.
  const kbIat = num(kb.payload.iat);
  if (kbIat === undefined || kbIat > o.nowSeconds + skew || kbIat < o.nowSeconds - o.maxPresentationAgeSeconds) throw reject("WALLET_PRESENTATION_STALE");
  checks.push("presentation_fresh");

  const { cnf: _cnf, ...visible } = claims;
  void _cnf;
  return { issuer: signer, claims: visible, credentialExpiresAt: exp, checks, presentationSha256: sha256(token) };
}
