import { and, eq, isNull, inArray } from "drizzle-orm";
import { applicants, documents } from "@/db/schema";
import { audit } from "@/lib/audit";
import { isTestScenario, type TestScenarioId } from "@/wallet";
import type { WalletRequest } from "@/wallet/types";
import { assertEditable, touch, type CaseRow, type IdentityData } from "./cases";
import type { PortalDeps } from "./deps";
import { PortalError } from "./errors";

// Wallet route of step 2.1.4 (docs/spec/09). The applicant never sees why a presentation failed (D7):
// the reason code goes to the audit trail for the analyst.

const NEUTRAL_FAILURE = "We couldn't verify your ID wallet. You can try again, or upload your document instead.";

function assertWalletAllowed(c: CaseRow) {
  // O-72: individuals only. A company representative's identity also feeds the KYB gap list.
  if (c.persona !== "individual") throw new PortalError("VALIDATION", "The ID wallet is available for individual applications only.");
}

/** Opens (or reuses) a wallet session for the case. */
export function startWallet(deps: PortalDeps, c: CaseRow): WalletRequest {
  assertWalletAllowed(c);
  assertEditable(c, "identity");
  const { request, created } = deps.wallet.verifier.startRequest(c.id);
  if (created) audit(deps.db, deps.now(), "system", "wallet.session_started", `case:${c.id}`, { sessionId: request.sessionId, audience: request.client_id, expiresAt: request.expiresAt });
  return request;
}

/** Verifies a presentation and, if it holds, completes the identity step with the wallet as the evidence source. */
export function completeIdentityWithWallet(deps: PortalDeps, c: CaseRow, sessionId: string, token: string): void {
  assertWalletAllowed(c);
  assertEditable(c, "identity");
  const now = deps.now();
  const result = deps.wallet.verifier.verify({ sessionId, caseId: c.id, token });
  if (!result.ok) {
    audit(deps.db, now, "system", "wallet.rejected", `case:${c.id}`, { sessionId, code: result.code, detail: result.detail });
    throw new PortalError("WALLET_FAILED", NEUTRAL_FAILURE);
  }
  const e = result.evidence;
  // Stored identity images from an earlier document attempt are stale evidence now: never read them again.
  deps.db
    .update(documents)
    .set({ supersededAt: now.toISOString() })
    .where(and(eq(documents.caseId, c.id), inArray(documents.kind, ["poi_front", "poi_back", "selfie"]), isNull(documents.supersededAt)))
    .run();
  const identity: IdentityData = {
    docType: "eudi_pid",
    issuingCountry: e.attributes.issuingCountry ?? e.issuer.country ?? e.attributes.nationalities[0]!,
    noExpiry: false,
    expiryDate: e.attributes.documentExpiry ?? e.credentialExpiresAt.slice(0, "yyyy-mm-dd".length),
    selfie: "not_required",
    complete: true,
    evidence: e,
  };
  touch(deps, c.id, { identity });
  audit(deps.db, now, "system", "wallet.verified", `case:${c.id}`, {
    sessionId,
    issuer: e.issuer.iss,
    credentialType: e.credentialType,
    checks: e.checks,
    ignoredClaims: e.ignoredClaims,
    presentationSha256: e.presentationSha256,
  });
  audit(deps.db, now, `applicant:${c.applicantId}`, "step.completed", `case:${c.id}`, { step: "identity", source: "wallet", assurance: "wallet_pid" });
}

/**
 * Test mode only (O-68): the built-in test wallet answers the open request for the applicant's own name,
 * following the chosen scenario. Everything after the token is the same path a real wallet would take.
 */
export function presentFromTestWallet(deps: PortalDeps, c: CaseRow, scenario: string): void {
  if (!isTestScenario(scenario)) throw new PortalError("VALIDATION", "Choose a test scenario.", { scenario: ["Choose a test scenario"] });
  const request = startWallet(deps, c);
  const applicant = deps.db.select().from(applicants).where(eq(applicants.id, c.applicantId)).get()!;
  const token = deps.wallet.testWallet.present({ request, holder: { givenName: applicant.firstName, familyName: applicant.lastName }, scenario: scenario as TestScenarioId });
  try {
    completeIdentityWithWallet(deps, c, request.sessionId, token);
  } catch (e) {
    // The failed attempt burned the nonce; open the next session so the page is ready for a retry.
    if (e instanceof PortalError && e.code === "WALLET_FAILED") startWallet(deps, c);
    throw e;
  }
}
