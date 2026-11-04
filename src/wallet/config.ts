import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

// ID wallet settings (docs/spec/09). Everything tunable lives in config/wallet.yaml.

const positiveInt = z.number().int().positive();
const claimName = z.string().min(1);

export const EVIDENCE_LEVEL_IDS = ["wallet_pid", "document_selfie", "document_selfie_flagged"] as const;
export type EvidenceLevelId = (typeof EVIDENCE_LEVEL_IDS)[number];

const jwk = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string().min(1), y: z.string().min(1) });
export type Jwk = z.infer<typeof jwk>;

export const trustedIssuerSchema = z.object({
  iss: z.string().min(1),
  kid: z.string().min(1),
  name: z.string().min(1),
  country: z.string().length(2).optional(),
  jwk,
});
export type TrustedIssuer = z.infer<typeof trustedIssuerSchema>;

const evidenceLevel = z.object({
  id: z.enum(EVIDENCE_LEVEL_IDS),
  rank: positiveInt,
  label: z.string().min(1),
  detail: z.string().min(1),
  satisfies_extra_kyc: z.boolean(),
});

export const walletConfigSchema = z
  .object({
    version: z.number().int(),
    mode: z.literal("test"),
    relying_party: z.object({ client_id: z.string().min(1), name: z.string().min(1) }),
    request: z.object({
      credential_type: z.string().min(1),
      required_claims: z.object({ given_name: claimName, family_name: claimName, birth_date: claimName, nationalities: claimName }),
      optional_claims: z.object({ address: claimName, document_expiry: claimName, issuing_country: claimName }),
      session_ttl_minutes: positiveInt,
      max_presentation_age_seconds: positiveInt,
    }),
    limits: z.object({ max_token_bytes: positiveInt, max_disclosures: positiveInt, max_claim_depth: positiveInt, clock_skew_seconds: positiveInt }),
    profile: z.object({
      allowed_algs: z.array(z.literal("ES256")).min(1),
      allowed_credential_typ: z.array(z.string().min(1)).min(1),
      key_binding_typ: z.string().min(1),
      digest_alg: z.literal("sha-256"),
    }),
    trusted_issuers: z.array(trustedIssuerSchema),
    evidence_levels: z.array(evidenceLevel).min(1),
    test_ecosystem: z.object({
      issuer: z.object({ iss: z.string().min(1), kid: z.string().min(1), name: z.string().min(1), country: z.string().length(2) }),
      untrusted_issuer: z.object({ iss: z.string().min(1), kid: z.string().min(1) }),
      credential_validity_days: positiveInt,
      expired_offset_days: positiveInt,
      document_validity_days: positiveInt,
      holder: z.object({
        birthdate: z.iso.date(),
        nationalities: z.array(z.string().length(2)).min(1),
        address: z.object({
          street_address: z.string(),
          house_number: z.string(),
          locality: z.string(),
          region: z.string(),
          postal_code: z.string(),
          country: z.string().length(2),
        }),
      }),
      name_differs_family_name: z.string().min(1),
    }),
  })
  .superRefine((c, ctx) => {
    const ids = c.evidence_levels.map((l) => l.id);
    for (const id of EVIDENCE_LEVEL_IDS)
      if (!ids.includes(id)) ctx.addIssue({ code: "custom", path: ["evidence_levels"], message: `evidence level "${id}" is missing` });
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["evidence_levels"], message: "evidence level ids must be unique" });
    const ranks = c.evidence_levels.map((l) => l.rank);
    if (new Set(ranks).size !== ranks.length) ctx.addIssue({ code: "custom", path: ["evidence_levels"], message: "evidence level ranks must be unique" });
  });

export type WalletConfig = z.infer<typeof walletConfigSchema>;

let cached: WalletConfig | undefined;

export function loadWalletConfig(file = path.resolve(/* turbopackIgnore: true */ process.cwd(), "config/wallet.yaml")): WalletConfig {
  if (!cached) cached = walletConfigSchema.parse(parse(fs.readFileSync(file, "utf8")));
  return cached;
}
