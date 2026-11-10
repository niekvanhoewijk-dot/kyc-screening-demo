import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toAnthropicTools, toMcpTools } from "@/agent/registry";
import { APPLICANT_TOOL_NAMES, applicantRegistry } from "@/agent/tools/applicant";

// Spec 10 sections 4.1, 5.3 and 13 (Registry): the registry is the contract every channel shares.

describe("applicant tool registry", () => {
  it("holds exactly the five spec 10 section 5.1 tools, and no tool that decides or submits", () => {
    expect(applicantRegistry.tools.map((t) => t.name)).toEqual([...APPLICANT_TOOL_NAMES]);
    expect([...APPLICANT_TOOL_NAMES].sort()).toEqual(["get_application_status", "get_next_questions", "get_review_summary", "request_secure_step", "save_answers"]);
    for (const name of APPLICANT_TOOL_NAMES) expect(name).not.toMatch(/submit|approve|reject|decide|declar|edd|clear|score/);
  });

  it("gives every tool a scope, a description, and strict input and output schemas", () => {
    for (const t of applicantRegistry.tools) {
      expect(t.scope).toBe("applicant");
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.name).toMatch(/^[a-z][a-z_]*$/);
      for (const schema of [t.input, t.output]) {
        const json = z.toJSONSchema(schema, { io: "input" }) as { type?: string; additionalProperties?: unknown };
        expect({ tool: t.name, type: json.type, additionalProperties: json.additionalProperties }).toEqual({ tool: t.name, type: "object", additionalProperties: false });
      }
    }
  });

  it("marks reads read-only and save_answers as the one write", () => {
    expect(Object.fromEntries(applicantRegistry.tools.map((t) => [t.name, t.readOnly]))).toEqual({
      get_application_status: true,
      get_next_questions: true,
      save_answers: false,
      get_review_summary: true,
      request_secure_step: true,
    });
  });

  it("keeps the output keys of each tool as published (a new key is a deliberate edit)", () => {
    const keys = (schema: z.ZodType) => {
      const json = z.toJSONSchema(schema) as { properties?: Record<string, { items?: { properties?: Record<string, unknown> } }> };
      return Object.fromEntries(Object.entries(json.properties ?? {}).map(([k, v]) => [k, v.items?.properties ? Object.keys(v.items.properties).sort() : true]));
    };
    expect(Object.fromEntries(applicantRegistry.tools.map((t) => [t.name, keys(t.output)]))).toMatchSnapshot();
  });

  it("adapts to Anthropic tool use and to MCP tool listings from the same definitions", () => {
    const anthropic = toAnthropicTools(applicantRegistry, "applicant");
    expect(anthropic.map((t) => t.name)).toEqual([...APPLICANT_TOOL_NAMES]);
    for (const t of anthropic) expect(t.input_schema).toMatchObject({ type: "object" });

    const mcp = toMcpTools(applicantRegistry, "applicant");
    expect(mcp.map((t) => t.name)).toEqual([...APPLICANT_TOOL_NAMES]);
    for (const t of mcp) {
      expect(t.inputSchema).toMatchObject({ type: "object" });
      expect(t.outputSchema).toMatchObject({ type: "object" });
      expect(t.annotations.readOnlyHint).toBe(applicantRegistry.get(t.name)!.readOnly);
      expect(t.annotations.destructiveHint).toBe(false);
    }
    expect(toAnthropicTools(applicantRegistry, "analyst")).toEqual([]);
  });
});
