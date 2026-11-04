import type { KeyObject } from "node:crypto";
import type { TrustedIssuer, WalletConfig } from "./config";
import { buildPresentation, issueSdJwt, jwkOf, makeDisclosure, newEcKeyPair } from "./sd-jwt";
import type { WalletRequest } from "./types";

// The built-in test ecosystem (docs/spec/09 sections 8 and 9): a demo PID issuer, a second issuer that is
// not trusted, and a wallet that can misbehave in a named way. Synthetic data only. Test mode only.

export const TEST_SCENARIOS = [
  { id: "valid", label: "Share a valid ID", outcome: "Verified" },
  { id: "name_differs", label: "Valid ID, different family name", outcome: "Verified; the analyst sees a name mismatch" },
  { id: "expired_credential", label: "Credential has expired", outcome: "Rejected" },
  { id: "untrusted_issuer", label: "Issuer is not on the trust list", outcome: "Rejected" },
  { id: "tampered_attribute", label: "An attribute was changed after issuance", outcome: "Rejected" },
  { id: "wrong_holder_key", label: "Presented with a different key than the credential's", outcome: "Rejected" },
  { id: "no_key_binding", label: "Presented without proof of the holder's key", outcome: "Rejected" },
  { id: "withheld_birthdate", label: "Holder declines to share the birth date", outcome: "Rejected" },
  { id: "replay", label: "Earlier presentation sent again", outcome: "Rejected" },
] as const;
export type TestScenarioId = (typeof TEST_SCENARIOS)[number]["id"];
export const isTestScenario = (id: string): id is TestScenarioId => TEST_SCENARIOS.some((s) => s.id === id);

const DAY = 86_400;

export class TestEcosystem {
  private readonly issuerKey: KeyObject;
  private readonly rogueKey: KeyObject;
  readonly demoIssuer: TrustedIssuer;

  constructor(readonly config: WalletConfig) {
    const issuer = newEcKeyPair();
    this.issuerKey = issuer.privateKey;
    this.rogueKey = newEcKeyPair().privateKey;
    const i = config.test_ecosystem.issuer;
    this.demoIssuer = { iss: i.iss, kid: i.kid, name: i.name, country: i.country, jwk: jwkOf(issuer.publicKey) };
  }

  /** What the verifier trusts: configured issuers plus the demo issuer. The rogue issuer is never listed. */
  get trustList(): TrustedIssuer[] {
    return [...this.config.trusted_issuers, this.demoIssuer];
  }

  signingKey(rogue: boolean) {
    return rogue ? this.rogueKey : this.issuerKey;
  }
}

export type TestHolder = { givenName: string; familyName: string; birthDate?: string; nationalities?: string[] };

export class TestWallet {
  /** The last presentation this wallet made, for the replay scenario. */
  private last: string | undefined;

  constructor(
    private readonly eco: TestEcosystem,
    private readonly now: () => Date,
  ) {}

  present(args: { request: WalletRequest; holder: TestHolder; scenario: TestScenarioId }): string {
    const now = Math.floor(this.now().getTime() / 1000);
    const kb = { iat: now, aud: args.request.client_id, nonce: args.request.nonce };
    if (args.scenario === "replay") {
      // Everything about the earlier presentation is genuine; only the session it answered is not this one.
      return this.last ?? this.build(args, now, { ...kb, nonce: "nonce-of-an-earlier-session" });
    }
    const token = this.build(args, now, kb);
    this.last = token;
    return token;
  }

  private build(args: { request: WalletRequest; holder: TestHolder; scenario: TestScenarioId }, now: number, kb: { iat: number; aud: string; nonce: string }): string {
    const cfg = this.eco.config;
    const t = cfg.test_ecosystem;
    const r = cfg.request;
    const { scenario, request, holder } = args;

    const expired = scenario === "expired_credential";
    const rogue = scenario === "untrusted_issuer";
    const exp = expired ? now - t.expired_offset_days * DAY : now + t.credential_validity_days * DAY;
    const iat = expired ? exp - t.credential_validity_days * DAY : now;
    const issuer = rogue ? t.untrusted_issuer : t.issuer;
    const holderKey = newEcKeyPair();
    const documentExpiry = new Date((now + t.document_validity_days * DAY) * 1000).toISOString().slice(0, "yyyy-mm-dd".length);

    const { issuerJwt, disclosures } = issueSdJwt({
      header: { alg: "ES256", typ: cfg.profile.allowed_credential_typ[0], kid: issuer.kid },
      payload: { iss: issuer.iss, iat, exp, vct: r.credential_type, cnf: { jwk: jwkOf(holderKey.publicKey) } },
      selective: {
        [r.required_claims.given_name]: holder.givenName,
        [r.required_claims.family_name]: scenario === "name_differs" ? t.name_differs_family_name : holder.familyName,
        [r.required_claims.birth_date]: holder.birthDate ?? t.holder.birthdate,
        [r.required_claims.nationalities]: holder.nationalities ?? t.holder.nationalities,
        [r.optional_claims.address]: t.holder.address,
        [r.optional_claims.document_expiry]: documentExpiry,
        [r.optional_claims.issuing_country]: t.issuer.country,
      },
      issuerKey: this.eco.signingKey(rogue),
    });

    // The wallet shares only what the request names (and, for one scenario, less).
    const asked = new Set(request.dcql_query.credentials[0]?.claims.map((c) => c.path[0]));
    if (scenario === "withheld_birthdate") asked.delete(r.required_claims.birth_date);
    let shared = disclosures.filter((d) => d.name !== undefined && asked.has(d.name));
    if (scenario === "tampered_attribute")
      shared = shared.map((d) => (d.name === r.required_claims.family_name ? makeDisclosure(d.name, "Tampered", d.salt) : d));

    return buildPresentation({
      issuerJwt,
      disclosures: shared,
      keyBinding:
        scenario === "no_key_binding"
          ? undefined
          : { key: scenario === "wrong_holder_key" ? newEcKeyPair().privateKey : holderKey.privateKey, typ: cfg.profile.key_binding_typ, ...kb },
    });
  }
}
