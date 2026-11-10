import { describe, expect, it } from "vitest";
import { cases } from "@/db/schema";
import { checkRulesFromConfig } from "@/documents/factory";
import type { PreReviewDeps } from "@/documents/pre-review";
import { resetDemo } from "@/demo/seed";
import { loadAgentConfig } from "@/agent/config";
import { applicantRegistry } from "@/agent/tools/applicant";
import { questionnaireFields } from "@/portal/fields";
import { makeDeps } from "../portal/helpers";
import { agentAnswers, applicantAt, call, ctxFor, type Stage } from "./helpers";

// Spec 10 principle P4 and section 13 (Leak scan): no applicant tool output, description, message or label
// carries a forbidden term. Questionnaire labels the portal already shows are exempt (exempt_label_sources).

const agent = loadAgentConfig();
const terms = agent.guard.forbidden_terms;
const pattern = new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "i");

function exemptTexts(deps: ReturnType<typeof makeDeps>["deps"]): Set<string> {
  const out = new Set<string>();
  if (!agent.guard.exempt_label_sources.includes("questionnaire")) return out;
  for (const f of questionnaireFields(deps.engine, deps.portal)) {
    out.add(f.label);
    if (f.hint) out.add(f.hint);
    for (const o of f.options ?? []) out.add(o.label);
  }
  return out;
}

/** Every string inside a value, minus exempt questionnaire labels. */
function strings(value: unknown, exempt: Set<string>, acc: string[] = []): string[] {
  if (typeof value === "string") {
    if (!exempt.has(value)) acc.push(value);
  } else if (Array.isArray(value)) for (const v of value) strings(v, exempt, acc);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) (acc.push(k), strings(v, exempt, acc));
  return acc;
}

const hits = (texts: string[]) => texts.filter((t) => pattern.test(t));

async function exerciseAll(ctx: ReturnType<typeof ctxFor>) {
  const outputs: unknown[] = [];
  for (const [name, input] of [
    ["get_application_status", {}],
    ["get_next_questions", {}],
    ["save_answers", { answers: { phone: "not a phone", declaration: "on", favouriteColour: "blue", pep: "yes" } }],
    ["get_review_summary", {}],
    ["request_secure_step", { step: "identity" }],
    ["request_secure_step", { step: "residence" }],
    ["request_secure_step", { step: "review" }],
  ] as const)
    outputs.push(await call(ctx, name, input));
  return outputs;
}

describe("leak scan of the applicant tools", () => {
  it("has a non-empty forbidden list from config", () => {
    expect(terms).toEqual(expect.arrayContaining(["score", "band", "risk", "threshold", "screening", "sanction"]));
  });

  it("keeps every tool description free of forbidden terms", () => {
    expect(hits(applicantRegistry.tools.map((t) => `${t.name} ${t.description}`))).toEqual([]);
  });

  it("returns nothing forbidden for any seeded persona, from Low to Prohibited, the PEP and the company", async () => {
    const t = makeDeps("2026-11-10T10:00:00Z");
    const d: PreReviewDeps = { ...t.deps, checkRules: checkRulesFromConfig(), documentReader: () => { throw new Error("not used"); } };
    await resetDemo(d, { claude: "skip", actor: "cli" });
    const exempt = exemptTexts(t.deps);
    const seeded = d.db.select().from(cases).all();
    expect(seeded.length).toBeGreaterThanOrEqual(6);
    for (const c of seeded) {
      const out = await exerciseAll({ deps: d, actor: `applicant:${c.applicantId}`, channel: "mcp", client: { id: "c", name: "Sample client" } });
      expect({ persona: c.id, hits: hits(strings(out, exempt)) }).toEqual({ persona: c.id, hits: [] });
    }
  });

  for (const stage of ["overview", "identity", "residence", "questionnaire"] as Stage[]) {
    it(`returns nothing forbidden for a draft case at ${stage}`, async () => {
      const a = await applicantAt(stage);
      if (stage === "questionnaire") await call(ctxFor(a), "save_answers", { answers: Object.fromEntries(Object.entries(agentAnswers).slice(0, a.deps.agent.tools.save_answers.max_fields_per_call)) });
      const out = await exerciseAll(ctxFor(a));
      expect(hits(strings(out, exemptTexts(a.deps)))).toEqual([]);
    });
  }

  it("returns nothing forbidden on the ID wallet route", async () => {
    const a = await applicantAt("questionnaire", { wallet: true });
    const out = await exerciseAll(ctxFor(a));
    expect(hits(strings(out, exemptTexts(a.deps)))).toEqual([]);
  });
});
