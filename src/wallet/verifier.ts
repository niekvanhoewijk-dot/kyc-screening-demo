import { and, desc, eq, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { walletSessions } from "@/db/schema";
import { newId, randomToken } from "@/lib/ids";
import type { WalletConfig, TrustedIssuer } from "./config";
import { extractPid } from "./pid";
import { WalletRejection, type WalletRejectCode } from "./reasons";
import { verifySdJwtPresentation } from "./sd-jwt";
import type { WalletEvidence, WalletRequest } from "./types";

export type WalletResult = { ok: true; evidence: WalletEvidence } | { ok: false; code: WalletRejectCode; detail: string };

/** Relying-party side of the ID wallet flow. Swapping the test ecosystem for real trust lists touches this adapter, not the portal. */
export interface WalletVerifier {
  /** The open (pending, unexpired) request for the case, if any. Read-only. */
  openRequest(caseId: string): WalletRequest | null;
  /** The open request, or a new one; `created` says which. */
  startRequest(caseId: string): { request: WalletRequest; created: boolean };
  /** Shorthand for `startRequest(caseId).request`. */
  requestFor(caseId: string): WalletRequest;
  /** Consumes the session, then verifies. A failed attempt burns the nonce. */
  verify(input: { sessionId: string; caseId: string; token: string }): WalletResult;
}

type Options = { db: Db; config: WalletConfig; trust: TrustedIssuer[]; now: () => Date };

export class SdJwtWalletVerifier implements WalletVerifier {
  constructor(private readonly o: Options) {}

  private queryFor(): WalletRequest["dcql_query"] {
    const { request } = this.o.config;
    const names = [...Object.values(request.required_claims), ...Object.values(request.optional_claims)];
    return { credentials: [{ id: "pid", format: "dc+sd-jwt", meta: { vct_values: [request.credential_type] }, claims: names.map((n) => ({ path: [n] })) }] };
  }

  private toRequest(row: typeof walletSessions.$inferSelect): WalletRequest {
    return {
      sessionId: row.id,
      client_id: row.audience,
      response_type: "vp_token",
      response_mode: "direct_post",
      nonce: row.nonce,
      state: row.id,
      expiresAt: row.expiresAt,
      dcql_query: row.requested as WalletRequest["dcql_query"],
    };
  }

  private findOpen(caseId: string) {
    const { db, now } = this.o;
    return db
      .select()
      .from(walletSessions)
      .where(and(eq(walletSessions.caseId, caseId), eq(walletSessions.status, "pending"), gt(walletSessions.expiresAt, now().toISOString())))
      .orderBy(desc(walletSessions.createdAt))
      .get();
  }

  openRequest(caseId: string): WalletRequest | null {
    const open = this.findOpen(caseId);
    return open ? this.toRequest(open) : null;
  }

  requestFor(caseId: string): WalletRequest {
    return this.startRequest(caseId).request;
  }

  startRequest(caseId: string): { request: WalletRequest; created: boolean } {
    const { db, config, now } = this.o;
    const at = now();
    const open = this.findOpen(caseId);
    if (open) return { request: this.toRequest(open), created: false };
    const row: typeof walletSessions.$inferInsert = {
      id: newId(),
      caseId,
      nonce: randomToken(),
      audience: config.relying_party.client_id,
      requested: this.queryFor(),
      status: "pending",
      expiresAt: new Date(at.getTime() + config.request.session_ttl_minutes * 60_000).toISOString(),
      createdAt: at.toISOString(),
    };
    db.insert(walletSessions).values(row).run();
    return { request: this.toRequest(db.select().from(walletSessions).where(eq(walletSessions.id, row.id)).get()!), created: true };
  }

  verify({ sessionId, caseId, token }: { sessionId: string; caseId: string; token: string }): WalletResult {
    const { db, config, now } = this.o;
    const at = now();
    const session = db.select().from(walletSessions).where(eq(walletSessions.id, sessionId)).get();
    // Single use: claim the session before touching the token. Exactly one caller can win.
    const claimed =
      session && session.caseId === caseId
        ? db
            .update(walletSessions)
            .set({ status: "verifying" })
            .where(and(eq(walletSessions.id, sessionId), eq(walletSessions.status, "pending"), gt(walletSessions.expiresAt, at.toISOString())))
            .run().changes === 1
        : false;
    if (!session || !claimed) return { ok: false, code: "WALLET_SESSION_INVALID", detail: session ? `session is ${session.status} or expired` : "unknown session" };

    const finish = (status: "verified" | "rejected", extra: Partial<typeof walletSessions.$inferInsert>) =>
      db.update(walletSessions).set({ status, completedAt: now().toISOString(), ...extra }).where(eq(walletSessions.id, sessionId)).run();

    try {
      const { request, limits, profile } = config;
      const verified = verifySdJwtPresentation(token, {
        trust: this.o.trust,
        expectedVct: request.credential_type,
        audience: session.audience,
        nonce: session.nonce,
        nowSeconds: Math.floor(at.getTime() / 1000),
        clockSkewSeconds: limits.clock_skew_seconds,
        maxPresentationAgeSeconds: request.max_presentation_age_seconds,
        allowedAlgs: profile.allowed_algs,
        allowedCredentialTyp: profile.allowed_credential_typ,
        keyBindingTyp: profile.key_binding_typ,
        maxTokenBytes: limits.max_token_bytes,
        maxDisclosures: limits.max_disclosures,
        maxClaimDepth: limits.max_claim_depth,
      });
      const pid = extractPid(verified.claims, config, at.toISOString().slice(0, "yyyy-mm-dd".length));
      const evidence: WalletEvidence = {
        source: "wallet",
        sessionId,
        verifiedAt: at.toISOString(),
        issuer: { iss: verified.issuer.iss, name: verified.issuer.name, country: verified.issuer.country },
        credentialType: request.credential_type,
        credentialExpiresAt: new Date(verified.credentialExpiresAt * 1000).toISOString(),
        presentationSha256: verified.presentationSha256,
        attributes: pid.attributes,
        checks: [...verified.checks, ...pid.checks],
        ignoredClaims: pid.ignoredClaims,
      };
      finish("verified", { presentationSha256: verified.presentationSha256 });
      return { ok: true, evidence };
    } catch (e) {
      // Anything unexpected in untrusted input is a malformed token, not a server error.
      const code: WalletRejectCode = e instanceof WalletRejection ? e.code : "WALLET_TOKEN_MALFORMED";
      const detail = e instanceof WalletRejection ? e.detail : e instanceof Error ? e.name : "unknown";
      finish("rejected", { resultCode: code });
      return { ok: false, code, detail };
    }
  }
}
