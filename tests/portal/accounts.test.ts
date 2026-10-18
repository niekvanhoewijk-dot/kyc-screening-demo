import { describe, expect, it } from "vitest";
import { auditLog } from "@/db/schema";
import { createAccount, getSessionApplicant, resendOtp, startSignIn, verifyOtp } from "@/portal/accounts";
import { PortalError } from "@/portal/errors";
import { account, makeDeps } from "./helpers";

const code = (e: unknown) => (e instanceof PortalError ? e.code : e);
const attempt = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return code(e);
  }
  return "ok";
};

describe("account and OTP (2.1.1 - 2.1.2)", () => {
  it("creates an account, mails a code and starts a session on the right code", async () => {
    const { deps, mailer, lastCode } = makeDeps();
    await createAccount(deps, account());
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe("ada.sample@example.test");
    const { sessionToken } = verifyOtp(deps, "Ada.Sample@example.test", { code: lastCode() });
    expect(getSessionApplicant(deps, sessionToken)?.emailVerifiedAt).toBeTruthy();
  });

  it("never writes the code to the audit log", async () => {
    const { deps, lastCode } = makeDeps();
    await createAccount(deps, account());
    const log = JSON.stringify(deps.db.select().from(auditLog).all());
    expect(log).not.toContain(lastCode());
  });

  it("counts wrong codes and locks after the configured maximum", async () => {
    const { deps, lastCode } = makeDeps();
    await createAccount(deps, account());
    const wrong = lastCode() === "000000" ? "111111" : "000000";
    const max = deps.portal.otp.max_attempts;
    for (let i = 1; i < max; i++) expect(attempt(() => verifyOtp(deps, account().email, { code: wrong }))).toBe("OTP_INVALID");
    expect(attempt(() => verifyOtp(deps, account().email, { code: wrong }))).toBe("OTP_LOCKED");
    expect(attempt(() => verifyOtp(deps, account().email, { code: lastCode() }))).toBe("OTP_LOCKED");
  });

  it("expires codes after the TTL", async () => {
    const { deps, advance, lastCode } = makeDeps();
    await createAccount(deps, account());
    advance(deps.portal.otp.ttl_minutes * 60_000 + 1);
    expect(attempt(() => verifyOtp(deps, account().email, { code: lastCode() }))).toBe("OTP_EXPIRED");
  });

  it("enforces the resend cooldown and invalidates the older code", async () => {
    const { deps, advance, lastCode } = makeDeps();
    await createAccount(deps, account());
    const first = lastCode();
    await expect(resendOtp(deps, account().email)).rejects.toMatchObject({ code: "OTP_COOLDOWN" });
    advance(deps.portal.otp.resend_cooldown_seconds * 1000);
    await resendOtp(deps, account().email);
    if (first !== lastCode()) expect(attempt(() => verifyOtp(deps, account().email, { code: first }))).toBe("OTP_INVALID");
    expect(attempt(() => verifyOtp(deps, account().email, { code: lastCode() }))).toBe("ok");
  });

  it("does not reveal whether an email is registered", async () => {
    const { deps, mailer, advance } = makeDeps();
    await createAccount(deps, account());
    advance(deps.portal.otp.resend_cooldown_seconds * 1000);
    expect(await startSignIn(deps, { email: "nobody@example.test" })).toEqual({ email: "nobody@example.test" });
    expect(await createAccount(deps, account())).toEqual({ email: account().email }); // existing: code re-sent
    expect(mailer.sent).toHaveLength(2);
    expect(attempt(() => verifyOtp(deps, "nobody@example.test", { code: "123456" }))).toBe("OTP_EXPIRED");
  });

  it("validates the form and keeps company onboarding closed for now", async () => {
    const { deps } = makeDeps();
    await expect(createAccount(deps, { ...account(), email: "not-an-email" })).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { email: [expect.any(String)] },
    });
    await expect(createAccount(deps, { ...account(), persona: "company" })).rejects.toMatchObject({ fieldErrors: { persona: [expect.any(String)] } });
  });
});
