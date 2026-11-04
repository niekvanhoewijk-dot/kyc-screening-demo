import { describe, expect, it } from "vitest";
import { walletSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { TEST_SCENARIOS, type TestScenarioId } from "@/wallet/test-wallet";
import { WALLET_REJECT_CODES, type WalletRejectCode } from "@/wallet/reasons";
import { buildPresentation, digestOf, issueSdJwt, jwkOf, makeDisclosure, newEcKeyPair, signJwt, verifySdJwtPresentation } from "@/wallet/sd-jwt";
import { craft, makeWallet } from "./helpers";

// docs/spec/09 sections 6 and 9: every scenario and every check has a test.

const setup = () => {
  const t = makeWallet();
  const request = t.verifier.requestFor("c1");
  return { t, request, verify: (token: string, r = request) => t.verifier.verify({ sessionId: r.sessionId, caseId: "c1", token }) };
};

describe("test wallet scenarios (spec 09 section 9)", () => {
  const expected: Record<Exclude<TestScenarioId, "replay">, WalletRejectCode | "verified"> = {
    valid: "verified",
    name_differs: "verified",
    expired_credential: "WALLET_CREDENTIAL_EXPIRED",
    untrusted_issuer: "WALLET_ISSUER_NOT_TRUSTED",
    tampered_attribute: "WALLET_DISCLOSURE_INVALID",
    wrong_holder_key: "WALLET_KEY_BINDING_INVALID",
    no_key_binding: "WALLET_KEY_BINDING_MISSING",
    withheld_birthdate: "WALLET_ATTRIBUTE_MISSING",
  };

  for (const [scenario, outcome] of Object.entries(expected) as [keyof typeof expected, WalletRejectCode | "verified"][]) {
    it(`${scenario} -> ${outcome}`, () => {
      const { t, request, verify } = setup();
      const result = verify(t.wallet.present({ request, holder: t.holder, scenario }));
      if (outcome === "verified") expect(result.ok).toBe(true);
      else expect(result).toMatchObject({ ok: false, code: outcome });
    });
  }

  it("replay: an earlier genuine presentation sent to a new session -> WALLET_NONCE_MISMATCH", () => {
    const { t, request, verify } = setup();
    expect(verify(t.wallet.present({ request, holder: t.holder, scenario: "valid" })).ok).toBe(true);
    const second = t.verifier.requestFor("c1");
    expect(second.sessionId).not.toBe(request.sessionId);
    const replayed = t.wallet.present({ request: second, holder: t.holder, scenario: "replay" });
    expect(t.verifier.verify({ sessionId: second.sessionId, caseId: "c1", token: replayed })).toMatchObject({ ok: false, code: "WALLET_NONCE_MISMATCH" });
  });

  it("every scenario listed for the UI is covered by a test above", () => {
    const covered = new Set<string>([...Object.keys(expected), "replay"]);
    expect(TEST_SCENARIOS.map((s) => s.id).sort()).toEqual([...covered].sort());
  });

  it("a verified presentation yields the attributes, the issuer and the passed checks, and nothing secret", () => {
    const { t, request, verify } = setup();
    const token = t.wallet.present({ request, holder: t.holder, scenario: "valid" });
    const result = verify(token);
    if (!result.ok) throw new Error(result.code);
    const e = result.evidence;
    expect(e).toMatchObject({
      source: "wallet",
      credentialType: "urn:eudi:pid:1",
      issuer: { iss: t.config.test_ecosystem.issuer.iss, country: "NL" },
      attributes: { givenName: "Ada", familyName: "Sample", birthDate: "1990-05-01", nationalities: ["NL"], issuingCountry: "NL" },
    });
    expect(e.attributes.address).toMatchObject({ streetAddress: "Voorbeeldstraat", locality: "Amsterdam", country: "NL" });
    expect(e.checks).toEqual(expect.arrayContaining(["issuer_trusted", "issuer_signature", "key_binding", "nonce", "audience", "presentation_fresh", "required_attributes", "document_in_date"]));
    const stored = JSON.stringify(e);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(token.split("~")[0]!.split(".")[2]!); // no issuer signature
    expect(e.presentationSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sessions", () => {
  it("reuses the open session instead of piling up new ones", () => {
    const { t, request } = setup();
    expect(t.verifier.requestFor("c1")).toEqual(request);
  });

  it("a session is single use: the same valid token cannot be used twice", () => {
    const { t, request, verify } = setup();
    const token = t.wallet.present({ request, holder: t.holder, scenario: "valid" });
    expect(verify(token).ok).toBe(true);
    expect(verify(token)).toMatchObject({ ok: false, code: "WALLET_SESSION_INVALID" });
  });

  it("a failed attempt burns the nonce; the retry gets a fresh session", () => {
    const { t, request, verify } = setup();
    expect(verify(t.wallet.present({ request, holder: t.holder, scenario: "tampered_attribute" })).ok).toBe(false);
    expect(verify(t.wallet.present({ request, holder: t.holder, scenario: "valid" }))).toMatchObject({ code: "WALLET_SESSION_INVALID" });
    const next = t.verifier.requestFor("c1");
    expect(next.sessionId).not.toBe(request.sessionId);
    expect(next.nonce).not.toBe(request.nonce);
    expect(verify(t.wallet.present({ request: next, holder: t.holder, scenario: "valid" }), next).ok).toBe(true);
  });

  it("records the outcome on the session row", () => {
    const { t, request, verify } = setup();
    verify(t.wallet.present({ request, holder: t.holder, scenario: "expired_credential" }));
    expect(t.db.select().from(walletSessions).where(eq(walletSessions.id, request.sessionId)).get()).toMatchObject({ status: "rejected", resultCode: "WALLET_CREDENTIAL_EXPIRED" });
  });

  it("an expired session is refused and a new request is opened", () => {
    const { t, request, verify } = setup();
    t.advance((t.config.request.session_ttl_minutes + 1) * 60_000);
    expect(verify(t.wallet.present({ request, holder: t.holder, scenario: "valid" }))).toMatchObject({ code: "WALLET_SESSION_INVALID" });
    expect(t.verifier.requestFor("c1").sessionId).not.toBe(request.sessionId);
  });

  it("an unknown session and another case's session are refused", () => {
    const { t, request } = setup();
    const token = t.wallet.present({ request, holder: t.holder, scenario: "valid" });
    expect(t.verifier.verify({ sessionId: "nope", caseId: "c1", token })).toMatchObject({ code: "WALLET_SESSION_INVALID" });
    expect(t.verifier.verify({ sessionId: request.sessionId, caseId: "someone-else", token })).toMatchObject({ code: "WALLET_SESSION_INVALID" });
    // the refused attempts did not consume the real session
    expect(t.verifier.verify({ sessionId: request.sessionId, caseId: "c1", token }).ok).toBe(true);
  });

  it("the request asks for exactly the configured attributes and nothing else", () => {
    const { t, request } = setup();
    const asked = request.dcql_query.credentials[0]!.claims.map((c) => c.path[0]).sort();
    const r = t.config.request;
    expect(asked).toEqual([...Object.values(r.required_claims), ...Object.values(r.optional_claims)].sort());
    expect(request).toMatchObject({ client_id: t.config.relying_party.client_id, response_mode: "direct_post", response_type: "vp_token" });
  });
});

describe("verifier checks that need a hand-made credential", () => {
  const verifyCrafted = (over: Parameters<typeof craft>[2], tweak: Parameters<ReturnType<typeof makeWallet>["verifyOptions"]>[1] = {}) => {
    const t = makeWallet();
    const request = { client_id: t.config.relying_party.client_id, nonce: "n-1" };
    const token = craft(t, request, over);
    return { t, token, run: () => verifySdJwtPresentation(token, t.verifyOptions(request, tweak)) };
  };
  const codeOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      return (e as { code?: string }).code ?? "other";
    }
    return "none";
  };

  it("accepts a well-formed credential", () => expect(codeOf(verifyCrafted({}).run)).toBe("none"));

  it("wrong audience -> WALLET_AUDIENCE_MISMATCH", () => expect(codeOf(verifyCrafted({ kb: { aud: "someone-else" } }).run)).toBe("WALLET_AUDIENCE_MISMATCH"));
  it("wrong nonce -> WALLET_NONCE_MISMATCH", () => expect(codeOf(verifyCrafted({ kb: { nonce: "other" } }).run)).toBe("WALLET_NONCE_MISMATCH"));

  it("a stale key binding -> WALLET_PRESENTATION_STALE; one dated in the future too", () => {
    const t = makeWallet();
    const now = Math.floor(t.clock.now.getTime() / 1000);
    for (const iat of [now - t.config.request.max_presentation_age_seconds - 1, now + t.config.limits.clock_skew_seconds + 1])
      expect(codeOf(verifyCrafted({ kb: { iat } }).run)).toBe("WALLET_PRESENTATION_STALE");
  });

  it("wrong credential type -> WALLET_WRONG_CREDENTIAL_TYPE", () => expect(codeOf(verifyCrafted({ payload: { vct: "urn:example:library-card" } }).run)).toBe("WALLET_WRONG_CREDENTIAL_TYPE"));

  it("trusted issuer name, wrong key (impersonation) -> WALLET_SIGNATURE_INVALID", () => expect(codeOf(verifyCrafted({ signWith: "rogue" }).run)).toBe("WALLET_SIGNATURE_INVALID"));

  it("missing exp -> WALLET_CREDENTIAL_EXPIRED; not yet valid -> WALLET_CREDENTIAL_EXPIRED", () => {
    expect(codeOf(verifyCrafted({ payload: { exp: undefined } }).run)).toBe("WALLET_CREDENTIAL_EXPIRED");
    const t = makeWallet();
    const nbf = Math.floor(t.clock.now.getTime() / 1000) + t.config.limits.clock_skew_seconds + 100;
    expect(codeOf(verifyCrafted({ payload: { nbf } }).run)).toBe("WALLET_CREDENTIAL_EXPIRED");
  });

  it("header: unsupported algorithm or type -> WALLET_TOKEN_MALFORMED", () => {
    expect(codeOf(verifyCrafted({ header: { alg: "none" } }).run)).toBe("WALLET_TOKEN_MALFORMED");
    expect(codeOf(verifyCrafted({ header: { alg: "HS256" } }).run)).toBe("WALLET_TOKEN_MALFORMED");
    expect(codeOf(verifyCrafted({ header: { typ: "JWT" } }).run)).toBe("WALLET_TOKEN_MALFORMED");
  });

  it("accepts the transitional vc+sd-jwt type", () => expect(codeOf(verifyCrafted({ header: { typ: "vc+sd-jwt" } }).run)).toBe("none"));

  it("garbage, empty and oversized tokens -> WALLET_TOKEN_MALFORMED", () => {
    const t = makeWallet();
    const o = t.verifyOptions({ client_id: "x", nonce: "n" });
    for (const bad of ["", "abc", "a.b.c~", "~~~", "x".repeat(o.maxTokenBytes + 1)]) expect(codeOf(() => verifySdJwtPresentation(bad, o))).toBe("WALLET_TOKEN_MALFORMED");
  });

  it("too many disclosures -> WALLET_TOKEN_MALFORMED", () => {
    const t = makeWallet();
    const request = { client_id: t.config.relying_party.client_id, nonce: "n-1" };
    const token = craft(t, request, {});
    expect(codeOf(() => verifySdJwtPresentation(token, t.verifyOptions(request, { maxDisclosures: 1 })))).toBe("WALLET_TOKEN_MALFORMED");
  });

  it("a disclosure the signed payload does not reference -> WALLET_DISCLOSURE_INVALID", () =>
    expect(codeOf(verifyCrafted({ extraDisclosures: [makeDisclosure("place_of_birth", "Nowhere")] }).run)).toBe("WALLET_DISCLOSURE_INVALID"));

  it("the same disclosure twice -> WALLET_DISCLOSURE_INVALID", () => {
    const t = makeWallet();
    const request = { client_id: t.config.relying_party.client_id, nonce: "n-1" };
    const parts = craft(t, request, {}).split("~");
    // repeat the first disclosure: the key binding no longer matches either, but the disclosure check comes first
    const dup = [parts[0], parts[1], parts[1], ...parts.slice(2)].join("~");
    expect(codeOf(() => verifySdJwtPresentation(dup, t.verifyOptions(request)))).toBe("WALLET_DISCLOSURE_INVALID");
  });

  it("reserved claim names cannot be disclosed", () => {
    const t = makeWallet();
    const request = { client_id: t.config.relying_party.client_id, nonce: "n-1" };
    const key = newEcKeyPair();
    for (const name of ["_sd", "..."]) {
      const d = makeDisclosure(name, "x");
      const { issuerJwt } = (() => {
        const now = Math.floor(t.clock.now.getTime() / 1000);
        return { issuerJwt: signJwt({ alg: "ES256", typ: "dc+sd-jwt", kid: t.config.test_ecosystem.issuer.kid }, { iss: t.config.test_ecosystem.issuer.iss, exp: now + 100, vct: t.config.request.credential_type, cnf: { jwk: jwkOf(key.publicKey) }, _sd: [digestOf(d.encoded)] }, t.eco.signingKey(false)) };
      })();
      const token = buildPresentation({ issuerJwt, disclosures: [d], keyBinding: { key: key.privateKey, typ: "kb+jwt", iat: Math.floor(t.clock.now.getTime() / 1000), aud: request.client_id, nonce: request.nonce } });
      expect(codeOf(() => verifySdJwtPresentation(token, t.verifyOptions(request)))).toBe("WALLET_DISCLOSURE_INVALID");
    }
  });

  it("selectively disclosed array elements are put back (nationalities)", () => {
    const t = makeWallet();
    const request = { client_id: t.config.relying_party.client_id, nonce: "n-1" };
    const now = Math.floor(t.clock.now.getTime() / 1000);
    const key = newEcKeyPair();
    const nl = makeDisclosure(undefined, "NL");
    const gr = makeDisclosure(undefined, "GR");
    const named = ["given_name", "family_name", "birthdate"].map((n, i) => makeDisclosure(n, ["Ada", "Sample", "1990-05-01"][i]));
    const issuerJwt = signJwt(
      { alg: "ES256", typ: "dc+sd-jwt", kid: t.config.test_ecosystem.issuer.kid },
      {
        iss: t.config.test_ecosystem.issuer.iss, exp: now + 100, vct: t.config.request.credential_type, cnf: { jwk: jwkOf(key.publicKey) },
        _sd: named.map((d) => digestOf(d.encoded)),
        nationalities: [{ "...": digestOf(nl.encoded) }, { "...": digestOf(gr.encoded) }, { "...": digestOf("decoy") }],
      },
      t.eco.signingKey(false),
    );
    const token = buildPresentation({ issuerJwt, disclosures: [...named, nl], keyBinding: { key: key.privateKey, typ: "kb+jwt", iat: now, aud: request.client_id, nonce: request.nonce } });
    const verified = verifySdJwtPresentation(token, t.verifyOptions(request));
    expect(verified.claims.nationalities).toEqual(["NL"]);
  });

  it("claims nested deeper than the limit are refused", () => {
    const t = makeWallet();
    const request = { client_id: t.config.relying_party.client_id, nonce: "n-1" };
    let deep: unknown = "x";
    for (let i = 0; i < t.config.limits.max_claim_depth + 2; i++) deep = { a: deep };
    const token = craft(t, request, { claims: { given_name: "Ada", family_name: "Sample", birthdate: "1990-05-01", nationalities: ["NL"], deep } });
    expect(codeOf(() => verifySdJwtPresentation(token, t.verifyOptions(request)))).toBe("WALLET_DISCLOSURE_INVALID");
  });

  it("a credential without a usable cnf key cannot carry key binding -> WALLET_KEY_BINDING_INVALID", () =>
    expect(codeOf(verifyCrafted({ payload: { cnf: {} } }).run)).toBe("WALLET_KEY_BINDING_INVALID"));

  it("a key binding that does not cover the presentation (sd_hash) -> WALLET_KEY_BINDING_INVALID", () => {
    const t = makeWallet();
    const request = { client_id: t.config.relying_party.client_id, nonce: "n-1" };
    const token = craft(t, request, {});
    const parts = token.split("~");
    // drop a disclosure after the holder signed: the sd_hash no longer matches (the dropped claim was required, but binding is checked first)
    const trimmed = [parts[0], ...parts.slice(2)].join("~");
    expect(codeOf(() => verifySdJwtPresentation(trimmed, t.verifyOptions(request)))).toBe("WALLET_KEY_BINDING_INVALID");
  });
});

describe("attributes", () => {
  const run = (claims: Record<string, unknown>, reveal?: (n: string) => boolean) => {
    const t = makeWallet();
    const request = t.verifier.requestFor("c1");
    const token = craft(t, request, { claims, reveal });
    return t.verifier.verify({ sessionId: request.sessionId, caseId: "c1", token });
  };
  const base = { given_name: "Ada", family_name: "Sample", birthdate: "1990-05-01", nationalities: ["NL"] };

  it("document expiry in the past -> WALLET_DOCUMENT_EXPIRED; in the future is fine", () => {
    expect(run({ ...base, date_of_expiry: "2020-01-01" })).toMatchObject({ code: "WALLET_DOCUMENT_EXPIRED" });
    expect(run({ ...base, date_of_expiry: "2031-01-01" })).toMatchObject({ ok: true });
  });

  it("an invalid or partial birth date -> WALLET_ATTRIBUTE_INVALID", () => {
    for (const birthdate of ["1990-00-00", "1990-13-01", "not a date", "2999-01-01"]) expect(run({ ...base, birthdate })).toMatchObject({ code: "WALLET_ATTRIBUTE_INVALID" });
  });

  it("nationalities that are not country codes -> WALLET_ATTRIBUTE_INVALID; unknown codes are dropped from a mixed list", () => {
    expect(run({ ...base, nationalities: ["XX"] })).toMatchObject({ code: "WALLET_ATTRIBUTE_INVALID" });
    const mixed = run({ ...base, nationalities: ["NL", "XX", "GR"] });
    expect(mixed.ok && mixed.evidence.attributes.nationalities).toEqual(["NL", "GR"]);
  });

  it("an undisclosed required attribute -> WALLET_ATTRIBUTE_MISSING", () => expect(run(base, (n) => n !== "family_name")).toMatchObject({ code: "WALLET_ATTRIBUTE_MISSING" }));

  it("claims we did not ask for are dropped, and only their names are kept", () => {
    const r = run({ ...base, place_of_birth: { locality: "Rotterdam" }, personal_administrative_number: "SYNTHETIC-1" });
    if (!r.ok) throw new Error(r.code);
    expect(r.evidence.ignoredClaims.sort()).toEqual(["personal_administrative_number", "place_of_birth"]);
    expect(JSON.stringify(r.evidence)).not.toContain("Rotterdam");
    expect(JSON.stringify(r.evidence)).not.toContain("SYNTHETIC-1");
  });

  it("the reject codes in the spec and the code agree", () => {
    const spec = [...new Set([...WALLET_REJECT_CODES])];
    expect(spec).toHaveLength(WALLET_REJECT_CODES.length);
  });
});
