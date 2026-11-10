import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadEngineConfig } from "@/engine";
import { COUNTRIES } from "@/lib/countries";
import { loadPortalConfig } from "@/portal/config";
import { fieldErrorsOf, OTHER_OCCUPATION, questionnaireSchema } from "@/portal/schemas";
import { questionnaire } from "./helpers";

// Phase 10a baseline (spec 10 section 6): recorded against the form and schema BEFORE the questionnaire
// refactor. The refactor must leave both snapshots byte-identical. Never update them to make a test pass.

vi.mock("@/app/apply/actions", () => {
  const noop = async () => ({});
  return { eddAction: noop, identityAction: noop, questionnaireAction: noop, residenceAction: noop, submitAction: noop };
});

const { QuestionnaireForm } = await import("@/app/apply/_forms/step-forms");

const engine = loadEngineConfig();
const portal = loadPortalConfig();
const opts = (list: { id: string; label: string }[]) => list.map(({ id, label }) => ({ id, label }));
const f = engine.matrix.factors;
const base = {
  email: "ada.sample@example.test",
  address: "1 Sample Street, Athens, Attica, 10552, Greece",
  countries: [...COUNTRIES],
  languages: portal.questionnaire.preferred_languages,
  factors: {
    deposit_12m: opts(f.deposit_12m),
    source_of_funds: opts(f.source_of_funds),
    employment_status: opts(f.employment_status),
    occupation_industry: [...opts(f.occupation_industry.values), OTHER_OCCUPATION],
    annual_income: opts(f.annual_income),
    net_worth: opts(f.net_worth),
  },
  back: "/apply/residence",
};
const savedAnswers = {
  ...questionnaire,
  usTaxResident: false,
  pep: true,
  declaration: true,
  onlySourceOfWealth: true,
  occupation_industry: OTHER_OCCUPATION.id,
  occupationDetail: "Sample industry",
  tinMissingReason: undefined,
};

const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(QuestionnaireForm, { ...base, saved: null, ...props } as never));

describe("questionnaire form markup (pre-refactor baseline)", () => {
  it("empty", () => expect(render({})).toMatchSnapshot());
  it("saved answers", () => expect(render({ saved: savedAnswers })).toMatchSnapshot());
  it("wallet-locked, one nationality", () => expect(render({ locked: { birthDate: "1990-05-01", nationalities: ["GR"] } })).toMatchSnapshot());
  it("wallet-locked, two nationalities", () => expect(render({ locked: { birthDate: "1990-05-01", nationalities: ["GR", "NL"] } })).toMatchSnapshot());
});

describe("questionnaire schema messages and output (pre-refactor baseline)", () => {
  const schema = questionnaireSchema(engine, portal, "2026-11-10");
  const errors = (input: Record<string, unknown>) => {
    const r = schema.safeParse(input);
    return r.success ? null : fieldErrorsOf(r.error);
  };
  it("every field wrong", () =>
    expect(
      errors({
        dateOfBirth: "2030-01-01",
        nationality: "XX",
        preferredLanguage: "tlh",
        phone: "12345",
        usTaxResident: "maybe",
        pep: "",
        deposit_12m: "lots",
        source_of_funds: "luck",
        employment_status: "x",
        occupation_industry: "x",
        annual_income: "x",
        net_worth: "x",
      }),
    ).toMatchSnapshot());
  it("nothing posted", () => expect(errors({})).toMatchSnapshot());
  it("no TIN and no reason", () => expect(errors({ ...questionnaire, tin: "" })).toMatchSnapshot());
  it("Other industry without detail", () => expect(errors({ ...questionnaire, occupation_industry: OTHER_OCCUPATION.id })).toMatchSnapshot());
  it("declaration not ticked", () => expect(errors({ ...questionnaire, declaration: "" })).toMatchSnapshot());
  it("valid input parses to the stored shape", () => expect(schema.parse({ ...questionnaire, onlySourceOfWealth: "on", tinMissingReason: "  " })).toMatchSnapshot());
});
