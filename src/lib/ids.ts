import crypto from "node:crypto";

export const newId = () => crypto.randomUUID();
export const sha256 = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");
export const randomToken = () => crypto.randomBytes(32).toString("base64url");

/** Uniform random numeric code of the given length (leading zeros allowed). */
export function numericCode(length: number): string {
  return Array.from({ length }, () => crypto.randomInt(0, 10)).join("");
}
