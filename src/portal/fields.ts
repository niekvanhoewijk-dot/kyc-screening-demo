import type { EngineConfig } from "@/engine";
import type { PortalConfig } from "./config";
import { OTHER_OCCUPATION, type QuestionnaireFieldId } from "./schemas";

// The questionnaire's questions, described once (spec 10 section 6). The form renders these labels and hints;
// the agent tools ask the same questions with the same words and options. Labels are the ones the portal
// already shows; they are the only applicant-facing text exempt from the agent leak scan (exempt_label_sources).

export type FieldType = "date" | "country" | "select" | "yes_no" | "text" | "tel" | "checkbox";
export type FieldSection = "about" | "tax" | "finances" | "declaration";

/** Client-safe text: labels, hints and section titles (no config needed). */
export const QUESTIONNAIRE_SECTIONS: Record<FieldSection, string> = {
  about: "About you",
  tax: "Tax and public roles",
  finances: "Your finances",
  declaration: "",
};

export const QUESTIONNAIRE_TEXT: Record<QuestionnaireFieldId, { label: string; hint?: string }> = {
  dateOfBirth: { label: "Date of birth", hint: "Must match the date on your ID." },
  nationality: { label: "Nationality" },
  preferredLanguage: { label: "Preferred language" },
  phone: { label: "Phone number with country code" },
  tin: { label: "Tax identification number (TIN)" },
  tinMissingReason: { label: "If you do not have one, tell us why", hint: "For example: income too low, or your country issues TINs only to companies." },
  usTaxResident: { label: "Are you a United States resident for tax purposes?" },
  pep: {
    label: "Are you currently, or have you previously been, a politically exposed person (PEP)?",
    hint: "Someone who holds or held a prominent public function, or a close family member or associate of such a person.",
  },
  deposit_12m: { label: "Expected deposits in the next 12 months" },
  source_of_funds: { label: "Main source of funds" },
  onlySourceOfWealth: { label: "This is my only source of wealth" },
  employment_status: { label: "Employment status" },
  occupation_industry: { label: "Industry of occupation" },
  occupationDetail: { label: "Industry details (if Other)" },
  annual_income: { label: "Total estimated annual income" },
  net_worth: { label: "Estimated net worth" },
  declaration: {
    label: "I declare that I have carefully read, accept and fully understood the risk disclosure and the terms and conditions. I understand that every investment involves risk.",
  },
};

export type Option = { id: string; label: string };
export type FieldDescription = {
  id: QuestionnaireFieldId;
  section: FieldSection;
  label: string;
  hint?: string;
  type: FieldType;
  options?: Option[];
  /** Required whenever the question is shown. */
  required: boolean;
  /** Set from the ID wallet when the applicant shared one (O-76). */
  walletLockable?: true;
  /** Asked only when another answer calls for it. */
  showWhen?: { field: QuestionnaireFieldId; is: "empty" | string };
  /** False: only the person answers it, on a portal page (the declaration, D20). */
  agent: boolean;
};

const opts = (list: { id: string; label: string }[]) => list.map(({ id, label }) => ({ id, label }));

/** The questionnaire in form order, with options from config/risk-matrix.yaml and config/portal.yaml. */
export function questionnaireFields(engine: EngineConfig, portal: PortalConfig): FieldDescription[] {
  const f = engine.matrix.factors;
  const t = (id: QuestionnaireFieldId) => QUESTIONNAIRE_TEXT[id];
  const q = (id: QuestionnaireFieldId, section: FieldSection, type: FieldType, rest: Partial<FieldDescription> = {}): FieldDescription => ({
    id,
    section,
    ...t(id),
    type,
    required: true,
    agent: true,
    ...rest,
  });
  return [
    q("dateOfBirth", "about", "date", { walletLockable: true }),
    q("nationality", "about", "country", { walletLockable: true }),
    q("preferredLanguage", "about", "select", { options: opts(portal.questionnaire.preferred_languages) }),
    q("phone", "about", "tel"),
    q("tin", "about", "text", { required: false }),
    q("tinMissingReason", "about", "text", { showWhen: { field: "tin", is: "empty" } }),
    q("usTaxResident", "tax", "yes_no"),
    q("pep", "tax", "yes_no"),
    q("deposit_12m", "finances", "select", { options: opts(f.deposit_12m) }),
    q("source_of_funds", "finances", "select", { options: opts(f.source_of_funds) }),
    q("onlySourceOfWealth", "finances", "checkbox", { required: false }),
    q("employment_status", "finances", "select", { options: opts(f.employment_status) }),
    q("occupation_industry", "finances", "select", { options: [...opts(f.occupation_industry.values), OTHER_OCCUPATION] }),
    q("occupationDetail", "finances", "text", { showWhen: { field: "occupation_industry", is: OTHER_OCCUPATION.id } }),
    q("annual_income", "finances", "select", { options: opts(f.annual_income) }),
    q("net_worth", "finances", "select", { options: opts(f.net_worth) }),
    q("declaration", "declaration", "checkbox", { agent: false }),
  ];
}
