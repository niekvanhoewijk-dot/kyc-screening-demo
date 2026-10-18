import crypto from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { applicants, cases, otpChallenges, sessions } from "@/db/schema";
import { audit } from "@/lib/audit";
import { newId, numericCode, randomToken, sha256 } from "@/lib/ids";
import type { PortalDeps } from "./deps";
import { PortalError } from "./errors";
import { accountSchema, otpSchema, parseOrThrow as parse, signInSchema } from "./schemas";

const minutes = (n: number) => n * 60_000;
const days = (n: number) => n * 86_400_000;


/**
 * 2.1.1 Create account. If the email already has an account we send a code to it instead,
 * with the same response, so the form does not reveal which emails are registered.
 */
export async function createAccount(deps: PortalDeps, input: unknown): Promise<{ email: string }> {
  const data = parse(accountSchema, input);
  const { db } = deps;
  const now = deps.now();
  const existing = db.select().from(applicants).where(eq(applicants.email, data.email)).get();
  if (existing) {
    await issueOtp(deps, existing.id, existing.email, { ignoreCooldown: false, quietCooldown: true });
    return { email: data.email };
  }
  const applicantId = newId();
  const caseId = newId();
  db.transaction((tx) => {
    tx.insert(applicants)
      .values({ id: applicantId, persona: data.persona, firstName: data.firstName, lastName: data.lastName, email: data.email, createdAt: now.toISOString() })
      .run();
    tx.insert(cases)
      .values({ id: caseId, applicantId, persona: data.persona, status: "draft", createdAt: now.toISOString(), updatedAt: now.toISOString() })
      .run();
  });
  audit(db, now, `applicant:${applicantId}`, "account.created", `case:${caseId}`, { persona: data.persona });
  await issueOtp(deps, applicantId, data.email, { ignoreCooldown: true });
  return { email: data.email };
}

/** Returning applicant: send a code if the email is known. Same response either way. */
export async function startSignIn(deps: PortalDeps, input: unknown): Promise<{ email: string }> {
  const { email } = parse(signInSchema, input);
  const applicant = deps.db.select().from(applicants).where(eq(applicants.email, email)).get();
  if (applicant) await issueOtp(deps, applicant.id, applicant.email, { ignoreCooldown: false, quietCooldown: true });
  return { email };
}

export async function resendOtp(deps: PortalDeps, email: string): Promise<void> {
  const applicant = deps.db.select().from(applicants).where(eq(applicants.email, email.toLowerCase())).get();
  if (applicant) await issueOtp(deps, applicant.id, applicant.email, { ignoreCooldown: false });
}

async function issueOtp(
  deps: PortalDeps,
  applicantId: string,
  email: string,
  opts: { ignoreCooldown: boolean; quietCooldown?: boolean },
) {
  const { db, portal } = deps;
  const now = deps.now();
  const latest = db.select().from(otpChallenges).where(eq(otpChallenges.applicantId, applicantId)).orderBy(desc(otpChallenges.createdAt)).get();
  if (!opts.ignoreCooldown && latest) {
    const waitMs = Date.parse(latest.createdAt) + portal.otp.resend_cooldown_seconds * 1000 - now.getTime();
    if (waitMs > 0) {
      if (opts.quietCooldown) return; // a code was just sent; the applicant can use that one
      throw new PortalError("OTP_COOLDOWN", `Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting a new code.`);
    }
  }
  const code = numericCode(portal.otp.length);
  db.insert(otpChallenges)
    .values({
      id: newId(),
      applicantId,
      codeHash: sha256(code),
      expiresAt: new Date(now.getTime() + minutes(portal.otp.ttl_minutes)).toISOString(),
      createdAt: now.toISOString(),
    })
    .run();
  audit(db, now, "system", "otp.issued", `applicant:${applicantId}`); // never log the code
  await deps.mailer.send({
    to: email,
    subject: "[Demo] Your verification code",
    text: `Your code is ${code}. It expires in ${portal.otp.ttl_minutes} minutes.\nIf you did not request this, ignore this email.`,
  });
}

/** 2.1.2 Verify the emailed code. Only the latest code counts. Returns a session token. */
export function verifyOtp(deps: PortalDeps, email: string, input: unknown): { sessionToken: string } {
  const { db, portal } = deps;
  const now = deps.now();
  const { code } = parse(otpSchema(portal.otp.length), input);
  const applicant = db.select().from(applicants).where(eq(applicants.email, email.toLowerCase())).get();
  const challenge =
    applicant &&
    db.select().from(otpChallenges).where(eq(otpChallenges.applicantId, applicant.id)).orderBy(desc(otpChallenges.createdAt)).get();

  // Unknown email and no challenge get the same message as an expired code.
  if (!applicant || !challenge || challenge.consumedAt || Date.parse(challenge.expiresAt) <= now.getTime())
    throw new PortalError("OTP_EXPIRED", "This code has expired. Request a new one.");
  if (challenge.attempts >= portal.otp.max_attempts)
    throw new PortalError("OTP_LOCKED", "Too many attempts. Request a new code.");

  const ok = crypto.timingSafeEqual(Buffer.from(sha256(code)), Buffer.from(challenge.codeHash));
  if (!ok) {
    const attempts = challenge.attempts + 1;
    db.update(otpChallenges).set({ attempts }).where(eq(otpChallenges.id, challenge.id)).run();
    audit(db, now, `applicant:${applicant.id}`, "otp.failed", `applicant:${applicant.id}`, { attempts });
    const left = portal.otp.max_attempts - attempts;
    if (left <= 0) throw new PortalError("OTP_LOCKED", "Too many attempts. Request a new code.");
    throw new PortalError("OTP_INVALID", `That code is not right. ${left} attempt${left === 1 ? "" : "s"} left.`, {
      code: ["That code is not right."],
    });
  }

  const token = randomToken();
  db.transaction((tx) => {
    tx.update(otpChallenges).set({ consumedAt: now.toISOString() }).where(eq(otpChallenges.id, challenge.id)).run();
    if (!applicant.emailVerifiedAt)
      tx.update(applicants).set({ emailVerifiedAt: now.toISOString() }).where(eq(applicants.id, applicant.id)).run();
    tx.insert(sessions)
      .values({
        tokenHash: sha256(token),
        applicantId: applicant.id,
        expiresAt: new Date(now.getTime() + days(portal.session.ttl_days)).toISOString(),
        createdAt: now.toISOString(),
      })
      .run();
  });
  audit(db, now, `applicant:${applicant.id}`, applicant.emailVerifiedAt ? "session.started" : "email.verified", `applicant:${applicant.id}`);
  return { sessionToken: token };
}

export function getSessionApplicant(deps: PortalDeps, token: string | undefined) {
  if (!token) return null;
  const row = deps.db
    .select({ applicant: applicants })
    .from(sessions)
    .innerJoin(applicants, eq(sessions.applicantId, applicants.id))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, deps.now().toISOString())))
    .get();
  return row?.applicant ?? null;
}

export function endSession(deps: PortalDeps, token: string | undefined) {
  if (!token) return;
  const s = deps.db.select().from(sessions).where(eq(sessions.tokenHash, sha256(token))).get();
  if (!s) return;
  deps.db.delete(sessions).where(eq(sessions.tokenHash, s.tokenHash)).run();
  audit(deps.db, deps.now(), `applicant:${s.applicantId}`, "session.ended", `applicant:${s.applicantId}`);
}
