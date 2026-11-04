import { createDb } from "@/db/client";
import { applicants, cases } from "@/db/schema";
import { loadWalletConfig } from "@/wallet/config";
import { TestEcosystem, TestWallet } from "@/wallet/test-wallet";
import { SdJwtWalletVerifier } from "@/wallet/verifier";
import { buildPresentation, issueSdJwt, jwkOf, newEcKeyPair, type Disclosure, type SdJwtVerifyOptions } from "@/wallet/sd-jwt";

/** A verifier over an in-memory database with one draft case, a test ecosystem and a test wallet. */
export function makeWallet(start = "2026-10-18T10:00:00Z") {
  const config = loadWalletConfig();
  const clock = { now: new Date(start) };
  const now = () => clock.now;
  const db = createDb(":memory:");
  const at = clock.now.toISOString();
  db.insert(applicants).values({ id: "a1", firstName: "Ada", lastName: "Sample", email: "ada.sample@example.test", persona: "individual", emailVerifiedAt: at, createdAt: at }).run();
  db.insert(cases).values({ id: "c1", applicantId: "a1", persona: "individual", status: "draft", createdAt: at, updatedAt: at }).run();
  const eco = new TestEcosystem(config);
  const verifier = new SdJwtWalletVerifier({ db, config, trust: eco.trustList, now });
  const wallet = new TestWallet(eco, now);
  const holder = { givenName: "Ada", familyName: "Sample" };
  const verifyOptions = (request: { client_id: string; nonce: string }, over: Partial<SdJwtVerifyOptions> = {}): SdJwtVerifyOptions => ({
    trust: eco.trustList,
    expectedVct: config.request.credential_type,
    audience: request.client_id,
    nonce: request.nonce,
    nowSeconds: Math.floor(clock.now.getTime() / 1000),
    clockSkewSeconds: config.limits.clock_skew_seconds,
    maxPresentationAgeSeconds: config.request.max_presentation_age_seconds,
    allowedAlgs: config.profile.allowed_algs,
    allowedCredentialTyp: config.profile.allowed_credential_typ,
    keyBindingTyp: config.profile.key_binding_typ,
    maxTokenBytes: config.limits.max_token_bytes,
    maxDisclosures: config.limits.max_disclosures,
    maxClaimDepth: config.limits.max_claim_depth,
    ...over,
  });
  return { config, clock, db, eco, verifier, wallet, holder, verifyOptions, advance: (ms: number) => (clock.now = new Date(clock.now.getTime() + ms)) };
}

type Json = Record<string, unknown>;

/** Hand-made credential for edge cases the test wallet does not offer. The holder discloses everything unless told otherwise. */
export function craft(
  t: ReturnType<typeof makeWallet>,
  request: { client_id: string; nonce: string },
  over: {
    claims?: Record<string, unknown>;
    payload?: Json;
    header?: Json;
    kb?: { iat?: number; aud?: string; nonce?: string };
    extraDisclosures?: Disclosure[];
    reveal?: (name: string) => boolean;
    signWith?: "trusted" | "rogue";
  } = {},
) {
  const { config } = t;
  const r = config.request;
  const now = Math.floor(t.clock.now.getTime() / 1000);
  const holderKey = newEcKeyPair();
  const claims: Record<string, unknown> = {
    [r.required_claims.given_name]: "Ada",
    [r.required_claims.family_name]: "Sample",
    [r.required_claims.birth_date]: "1990-05-01",
    [r.required_claims.nationalities]: ["NL"],
    ...over.claims,
  };
  const { issuerJwt, disclosures } = issueSdJwt({
    header: { alg: "ES256", typ: "dc+sd-jwt", kid: config.test_ecosystem.issuer.kid, ...over.header },
    payload: { iss: config.test_ecosystem.issuer.iss, iat: now, exp: now + 86_400, vct: r.credential_type, cnf: { jwk: jwkOf(holderKey.publicKey) }, ...over.payload },
    selective: claims,
    issuerKey: t.eco.signingKey(over.signWith === "rogue"),
  });
  const shared = disclosures.filter((d) => (over.reveal ? over.reveal(d.name ?? "") : true));
  return buildPresentation({
    issuerJwt,
    disclosures: [...shared, ...(over.extraDisclosures ?? [])],
    keyBinding: { key: holderKey.privateKey, typ: config.profile.key_binding_typ, iat: over.kb?.iat ?? now, aud: over.kb?.aud ?? request.client_id, nonce: over.kb?.nonce ?? request.nonce },
  });
}
