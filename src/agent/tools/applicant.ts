import { eq } from "drizzle-orm";
import { z } from "zod";
import { cases } from "@/db/schema";
import { audit } from "@/lib/audit";
import { countryName } from "@/lib/countries";
import { assertEditable, getCurrentCase, stepCase, today, type CaseRow, type IdentityData, type QuestionnaireData } from "@/portal/cases";
import { applicantView } from "@/portal/decision";
import { lockedFromWallet } from "@/portal/evidence";
import { questionnaireFields, type FieldDescription } from "@/portal/fields";
import { questionnaireShape, validateQuestionnaireField, type QuestionnaireFieldId } from "@/portal/schemas";
import { applicantStatusMessage } from "@/portal/status-text";
import { canOpen, completedSteps, resumeStep, stepsFor, type StepId } from "@/portal/steps";
import { draftsFor, upsertDraft, type DraftSource } from "../drafts";
import { defineRegistry, defineTool, NOT_AVAILABLE, ToolDenied, type ToolContext } from "../registry";

// The five applicant tools (docs/spec/10 section 5.1). They collect and explain; they never score, decide or submit.
// Every word here is read by third-party AI clients: no score, band, threshold, reason or screening term (section 5.3).

export const APPLICANT_TOOL_NAMES = ["get_application_status", "get_next_questions", "save_answers", "get_review_summary", "request_secure_step"] as const;

const MS_PER_MINUTE = 60_000; // unit conversion, not a business rule
const YES_NO = [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }];
const COUNTRY_HINT = "Two-letter country code, for example NL.";

// ---------- Case and question helpers ----------

/** The applicant's own case. A case id from the channel must belong to the actor. */
function caseOf(ctx: ToolContext): CaseRow {
  const applicantId = ctx.actor.slice("applicant:".length);
  const c = ctx.caseId ? ctx.deps.db.select().from(cases).where(eq(cases.id, ctx.caseId)).get() : getCurrentCase(ctx.deps, applicantId);
  if (!c || c.applicantId !== applicantId) throw new ToolDenied("scope", NOT_AVAILABLE, "scope");
  if (c.persona !== "individual") throw new ToolDenied("scope", "The assistant helps with applications for individuals only. Please use the portal.", "denied");
  ctx.caseId = c.id;
  return c;
}

type Answers = Record<string, { value: unknown; source: DraftSource | "form" | "wallet" }>;

/** Stored answers, overlaid by drafts, plus the values the ID wallet provided. */
function currentAnswers(ctx: ToolContext, c: CaseRow): Answers {
  const out: Answers = {};
  const stored = c.questionnaire as QuestionnaireData | null;
  if (stored) for (const [k, v] of Object.entries(stored)) if (k !== "complete" && k !== "provenance") out[k] = { value: v, source: stored.provenance?.[k]?.source ?? "form" };
  for (const [k, d] of Object.entries(draftsFor(ctx.deps, c.id, "questionnaire"))) out[k] = { value: d.value, source: d.source };
  const locked = lockedFromWallet(c.identity as IdentityData | null);
  if (locked) {
    out.dateOfBirth = { value: locked.birthDate, source: "wallet" };
    out.nationality = { value: locked.nationalities[0], source: "wallet" };
  }
  return out;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "";

/** The questions an agent may ask now, in form order: not the declaration, not wallet values, conditional ones when called for. */
function askable(ctx: ToolContext, c: CaseRow): FieldDescription[] {
  const locked = lockedFromWallet(c.identity as IdentityData | null);
  const answers = currentAnswers(ctx, c);
  return questionnaireFields(ctx.deps.engine, ctx.deps.portal).filter((f) => {
    if (!f.agent || (locked && f.walletLockable)) return false;
    if (!f.showWhen) return true;
    const ctl = answers[f.showWhen.field];
    return f.showWhen.is === "empty" ? ctl !== undefined && isEmpty(ctl.value) : ctl?.value === f.showWhen.is;
  });
}

const openQuestions = (ctx: ToolContext, c: CaseRow) => {
  const answers = currentAnswers(ctx, c);
  return askable(ctx, c).filter((f) => !(f.id in answers));
};

/** The answer an agent sends, in the shape the form posts (so the form's own rule checks it). */
function asFormValue(f: FieldDescription, raw: string | boolean | null): unknown {
  if (f.type === "checkbox") return raw === true || raw === "yes" || raw === "on" || raw === "true" ? "on" : "";
  if (f.type === "yes_no" && typeof raw === "boolean") return raw ? "yes" : "no";
  if (raw === null) return "";
  return typeof raw === "boolean" ? String(raw) : raw;
}

/** An answer as the applicant reads it on the review page. */
function display(f: FieldDescription, value: unknown): string {
  if (isEmpty(value)) return "Not provided";
  if (f.type === "yes_no" || f.type === "checkbox") return value === true ? "Yes" : "No";
  if (f.type === "country") return countryName(String(value));
  if (f.type === "select") return f.options?.find((o) => o.id === value)?.label ?? String(value);
  return String(value);
}

// ---------- Schemas (strict: an unlisted key is an error) ----------

const option = z.object({ id: z.string(), label: z.string() }).strict();
const stepState = z.enum(["done", "open", "not_yet"]);
const nextKind = z.enum(["portal_page", "questions", "review_on_portal", "submit_on_portal", "none"]);

const statusOut = z
  .object({
    steps: z.array(z.object({ id: z.string(), title: z.string(), state: stepState }).strict()),
    nextAction: z.object({ step: z.string(), title: z.string(), kind: nextKind }).strict(),
    message: z.string(),
  })
  .strict();

const question = z
  .object({
    id: z.string(),
    label: z.string(),
    hint: z.string().optional(),
    type: z.enum(["date", "country", "select", "yes_no", "text", "tel", "checkbox"]),
    options: z.array(option).optional(),
    required: z.boolean(),
  })
  .strict();

const answerValue = z.union([z.string(), z.boolean(), z.null()]);

// ---------- Tools ----------

const getApplicationStatus = defineTool({
  name: "get_application_status",
  scope: "applicant",
  description:
    "Shows where the applicant is in the application: each step, whether it is done, open or not yet available, what to do next, and a short status message to pass on. Call it at the start and again after the applicant finishes a step on the portal.",
  input: z.object({}).strict(),
  output: statusOut,
  readOnly: true,
  handler: async (ctx) => {
    const c = caseOf(ctx);
    const sc = stepCase(c);
    const done = completedSteps(sc);
    const steps = stepsFor(sc).map((s) => ({ id: s.id, title: s.title, state: done[s.id] ? ("done" as const) : canOpen(s.id, sc) ? ("open" as const) : ("not_yet" as const) }));
    const view = applicantView(c);
    const next: StepId = resumeStep(sc);
    const title = stepsFor(sc).find((s) => s.id === next)?.title ?? "";
    const kind: z.infer<typeof nextKind> =
      view.kind !== "draft" ? "none" : next === "questionnaire" ? (openQuestions(ctx, c).length ? "questions" : "review_on_portal") : next === "check" ? "submit_on_portal" : "portal_page";
    return { steps, nextAction: { step: next, title, kind }, message: applicantStatusMessage(view.kind) };
  },
});

const getNextQuestions = defineTool({
  name: "get_next_questions",
  scope: "applicant",
  description:
    "Returns the next unanswered questions of the application, in order, with their exact wording, hint, answer type and allowed options. Ask them in this wording or a faithful translation and never add questions of your own. Dates are yyyy-mm-dd, countries are two-letter codes, choices use the option id. remaining is the number of open questions, including these.",
  input: z.object({ limit: z.number().int().positive().optional() }).strict(),
  output: z.object({ questions: z.array(question), remaining: z.number().int() }).strict(),
  readOnly: true,
  handler: async (ctx, input) => {
    const c = caseOf(ctx);
    assertEditable(c, "questionnaire");
    const open = openQuestions(ctx, c);
    const max = ctx.deps.agent.tools.get_next_questions.max_questions;
    const questions = open.slice(0, Math.min(input.limit ?? max, max)).map((f) => ({
      id: f.id,
      label: f.label,
      ...(f.hint ? { hint: f.hint } : f.type === "country" ? { hint: COUNTRY_HINT } : {}),
      type: f.type,
      ...(f.options ? { options: f.options } : f.type === "yes_no" || f.type === "checkbox" ? { options: YES_NO } : {}),
      required: f.required,
    }));
    return { questions, remaining: open.length };
  },
});

const saveAnswers = defineTool({
  name: "save_answers",
  scope: "applicant",
  description:
    "Saves the applicant's answers as drafts for them to check later. Send {questionId: value} with option ids, yes or no, yyyy-mm-dd dates and two-letter country codes. Each answer is checked with the same rule as the form; rejected answers come back with the form's own message to read to the applicant. Nothing counts until the applicant confirms every answer on the review page.",
  input: z.object({ answers: z.record(z.string(), answerValue) }).strict(),
  output: z
    .object({
      accepted: z.array(z.string()),
      rejected: z.array(z.object({ field: z.string(), message: z.string() }).strict()),
      remaining: z.array(z.string()),
    })
    .strict(),
  readOnly: false,
  idempotent: true,
  handler: async (ctx, input) => {
    const max = ctx.deps.agent.tools.save_answers.max_fields_per_call;
    if (Object.keys(input.answers).length > max) throw new ToolDenied("cap", `Send at most ${max} answers at a time.`);
    const c = caseOf(ctx);
    assertEditable(c, "questionnaire");
    const locked = lockedFromWallet(c.identity as IdentityData | null);
    const shape = questionnaireShape(ctx.deps.engine, ctx.deps.portal, today(ctx.deps.now()));
    const fields = questionnaireFields(ctx.deps.engine, ctx.deps.portal);
    const source: DraftSource = ctx.channel === "mcp" ? "mcp" : "interviewer";
    const accepted: string[] = [];
    const rejected: { field: string; message: string }[] = [];
    for (const [id, raw] of Object.entries(input.answers)) {
      const f = fields.find((x) => x.id === id);
      if (!f) rejected.push({ field: id, message: "This question is not part of the application." });
      else if (!f.agent) rejected.push({ field: id, message: "Please tick this yourself on the review page." });
      else if (locked && f.walletLockable) rejected.push({ field: id, message: "Provided by your ID wallet." });
      else {
        const r = validateQuestionnaireField(shape, id as QuestionnaireFieldId, asFormValue(f, raw));
        if (!r.ok) rejected.push({ field: id, message: r.message });
        else {
          upsertDraft(ctx.deps, { caseId: c.id, step: "questionnaire", field: id, value: r.value, source, ...(ctx.client ? { client: ctx.client } : {}) });
          accepted.push(id);
        }
      }
    }
    return { accepted, rejected, remaining: openQuestions(ctx, c).map((f) => f.id) };
  },
});

const getReviewSummary = defineTool({
  name: "get_review_summary",
  scope: "applicant",
  description:
    "Reads back every saved answer with its question, the answer as the applicant will see it on the review page, and where it came from, plus the questions still missing. Call it before sending the applicant to the review page.",
  input: z.object({}).strict(),
  output: z
    .object({
      items: z.array(z.object({ id: z.string(), label: z.string(), value: z.string(), source: z.enum(["form", "interviewer", "mcp", "wallet"]) }).strict()),
      missing: z.array(z.string()),
    })
    .strict(),
  readOnly: true,
  handler: async (ctx) => {
    const c = caseOf(ctx);
    const answers = currentAnswers(ctx, c);
    const fields = questionnaireFields(ctx.deps.engine, ctx.deps.portal);
    const items = fields.filter((f) => f.agent && f.id in answers).map((f) => ({ id: f.id, label: f.label, value: display(f, answers[f.id]!.value), source: answers[f.id]!.source }));
    const missing = askable(ctx, c).filter((f) => f.required && !(f.id in answers)).map((f) => f.id);
    return { items, missing };
  },
});

const SECURE: Record<"identity" | "residence" | "review", { step: StepId; url: string; purpose: string }> = {
  identity: { step: "identity", url: "/apply/identity?via=assistant", purpose: "Prove who you are with your ID wallet, or with an identity document and a selfie, on a secure portal page." },
  residence: { step: "residence", url: "/apply/residence?via=assistant", purpose: "Enter your address and upload a recent proof of where you live, on a secure portal page." },
  review: { step: "questionnaire", url: "/apply/questionnaire?review=1", purpose: "Check every answer, tick the declaration yourself and continue, on a secure portal page." },
};

const requestSecureStep = defineTool({
  name: "request_secure_step",
  scope: "applicant",
  description:
    "Gives a link to a step that happens on a secure portal page: identity (ID wallet, or document and selfie), residence (address and proof of residence upload) or review (check the answers, tick the declaration, continue). The applicant opens it while signed in to the portal. Nothing sensitive passes through this conversation.",
  input: z.object({ step: z.enum(["identity", "residence", "review"]) }).strict(),
  output: z.object({ url: z.string(), expiresAt: z.string(), purpose: z.string() }).strict(),
  readOnly: true,
  handler: async (ctx, input) => {
    const c = caseOf(ctx);
    const target = SECURE[input.step];
    assertEditable(c, target.step);
    audit(ctx.deps.db, ctx.deps.now(), ctx.actor, "agent.secure_step_requested", `case:${c.id}`, { step: input.step, channel: ctx.channel, clientId: ctx.client?.id });
    const expiresAt = new Date(ctx.deps.now().getTime() + ctx.deps.agent.mcp.secure_link_ttl_minutes * MS_PER_MINUTE).toISOString();
    return { url: target.url, expiresAt, purpose: target.purpose };
  },
});

export const applicantRegistry = defineRegistry([getApplicationStatus, getNextQuestions, saveAnswers, getReviewSummary, requestSecureStep]);
