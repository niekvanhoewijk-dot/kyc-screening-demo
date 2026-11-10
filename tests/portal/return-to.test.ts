import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { returnPath } from "@/app/apply/return-to";

// Phase 10b: a step finished from the interviewer's card returns to the chat. Only one fixed target is allowed,
// so the field can never become an open redirect.

const fd = (v?: string) => {
  const f = new FormData();
  if (v !== undefined) f.set("returnTo", v);
  return f;
};

describe("return to the interviewer after a step", () => {
  it("goes back to the chat only for returnTo=interview", () => {
    expect(returnPath(fd("interview"))).toBe("/apply/interview");
    for (const v of [undefined, "", "https://example.com", "//evil.example", "/apply/status", "INTERVIEW", "interview "]) expect(returnPath(fd(v))).toBeNull();
  });

  it("is used by every step action an interviewer card posts to", () => {
    const src = fs.readFileSync(path.resolve("src/app/apply/actions.ts"), "utf8");
    for (const action of ["identityAction", "startWalletAction", "presentTestWalletAction", "residenceAction"]) {
      const body = src.slice(src.indexOf(`export async function ${action}`));
      const end = body.indexOf("\nexport ", 1);
      expect({ action, uses: /returnPath\(fd\)/.test(body.slice(0, end === -1 ? undefined : end)) }).toEqual({ action, uses: true });
    }
  });
});
