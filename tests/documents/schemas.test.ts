import { describe, expect, it } from "vitest";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { REASON_CODES } from "@/documents/reason-codes";
import { poiExtractionSchema, porExtractionSchema, validateExtraction } from "@/documents/schemas";
import { poi } from "./extractions";

describe("extraction schemas", () => {
  it.each([["poi", poiExtractionSchema], ["por", porExtractionSchema]] as const)("%s converts to a structured-output JSON schema", (_, schema) => {
    const format = betaZodOutputFormat(schema) as unknown as { type: string; schema: { type: string; required: string[]; additionalProperties: boolean } };
    expect(format.type).toBe("json_schema");
    expect(format.schema.type).toBe("object");
    expect(format.schema.additionalProperties).toBe(false);
    expect(format.schema.required.length).toBeGreaterThan(5);
  });

  it("issue enums only contain codes from the closed list", () => {
    const codes = [...poiExtractionSchema.shape.issues.element.options, ...porExtractionSchema.shape.issues.element.options];
    for (const c of codes) expect(REASON_CODES).toContain(c);
  });

  it("rejects confidences outside 0-1 and malformed dates", () => {
    expect(validateExtraction(poi())).toEqual([]);
    expect(validateExtraction(poi({ overall_confidence: 1.4, expiry_date: "31/01/2031" }))).toHaveLength(2);
  });
});
