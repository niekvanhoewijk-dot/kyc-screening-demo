import { z } from "zod";
import type { EngineConfig } from "@/engine";
import { isCountryCode } from "@/lib/countries";
import type { PortalConfig } from "./config";
import { PortalError, type FieldErrors } from "./errors";

// Form-level validation. Inputs arrive as strings from FormData; schemas coerce and give
// applicant-friendly messages.

const required = (label: string) => z.string().trim().min(1, `${label} is required`);
const optional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
const yesNo = (label: string) =>
  z.enum(["yes", "no"], `Please answer: ${label}`).transform((v) => v === "yes");
const country = (label: string) =>
  required(label).refine((c) => isCountryCode(c), `Choose a valid ${label.toLowerCase()}`);
const isoDate = (label: string) => z.iso.date(`${label} must be a valid date`);
const oneOf = (ids: string[], label: string) =>
  z.string().refine((v) => ids.includes(v), `Choose a valid ${label.toLowerCase()}`);

const PO_BOX = /\b(p\.?\s*o\.?\s*box|post\s*office\s*box|postbus|postfach|apartado\s+de\s+correos)\b/i;
const PHONE = /^\+[1-9]\d{6,14}$/;
const normalisePhone = (v: string) => v.replace(/[\s().-]/g, "");

export const accountSchema = z.object({
  persona: z.enum(["individual", "company"], "Choose Individual or Company"),
  firstName: required("First name").max(100),
  lastName: required("Last name").max(100),
  email: z.email("Enter a valid email address").transform((e) => e.toLowerCase()),
});

export const signInSchema = z.object({
  email: z.email("Enter a valid email address").transform((e) => e.toLowerCase()),
});

export const otpSchema = (length: number) =>
  z.object({
    code: z
      .string()
      .trim()
      .regex(new RegExp(`^\\d{${length}}$`), `Enter the ${length}-digit code from the email`),
  });

export function identityFieldsSchema(portal: PortalConfig, today: string) {
  return z
    .object({
      docType: oneOf(portal.poi.document_types.map((d) => d.id), "Document type"),
      issuingCountry: country("Issuing country"),
      noExpiry: checkbox,
      expiryDate: optional,
    })
    .superRefine((v, ctx) => {
      if (v.noExpiry) return;
      if (!v.expiryDate) {
        ctx.addIssue({ code: "custom", path: ["expiryDate"], message: "Enter the expiry date, or tick \"My document has no expiration date\"" });
      } else if (!isoDate("Expiry date").safeParse(v.expiryDate).success) {
        ctx.addIssue({ code: "custom", path: ["expiryDate"], message: "Expiry date must be a valid date" });
      } else if (v.expiryDate < today) {
        // spec 02: POI must be valid (not expired)
        ctx.addIssue({ code: "custom", path: ["expiryDate"], message: "This document has expired. Please use a valid document." });
      }
    });
}

export function residenceFieldsSchema(portal: PortalConfig) {
  const noPoBox = <S extends z.ZodType<string | undefined>>(label: string, s: S) =>
    s.refine((v) => !v || !PO_BOX.test(v), `${label}: we can't accept a P.O. box. Enter your residential address.`);
  return z
    .object({
      apartment: optional,
      addressLine1: noPoBox("Address line 1", required("Address line 1").max(200)),
      addressLine2: noPoBox("Address line 2", optional),
      city: required("City, town or village").max(100),
      region: required("County or region").max(100),
      country: country("Country"),
      postcode: optional,
      mobilePhone: optional,
      landlinePhone: optional,
      porType: oneOf(portal.por.document_types.map((d) => d.id), "Document type"),
    })
    .superRefine((v, ctx) => {
      for (const key of ["mobilePhone", "landlinePhone"] as const) {
        const raw = v[key];
        if (raw && !PHONE.test(normalisePhone(raw)))
          ctx.addIssue({ code: "custom", path: [key], message: "Use international format, e.g. +31 6 1234 5678" });
      }
    })
    .transform((v) => ({
      ...v,
      mobilePhone: v.mobilePhone && normalisePhone(v.mobilePhone),
      landlinePhone: v.landlinePhone && normalisePhone(v.landlinePhone),
    }));
}

/** Occupation is an open list (O-5): config values plus "other", which takes the default tier. */
export const OTHER_OCCUPATION = { id: "other", label: "Other" };

export function questionnaireSchema(engine: EngineConfig, portal: PortalConfig, today: string) {
  const f = engine.matrix.factors;
  const ids = (list: { id: string }[]) => list.map((v) => v.id);
  return z
    .object({
      dateOfBirth: isoDate("Date of birth").refine((d) => d < today, "Date of birth must be in the past"),
      nationality: country("Nationality"),
      preferredLanguage: oneOf(ids(portal.questionnaire.preferred_languages), "Preferred language"),
      phone: required("Phone number")
        .transform(normalisePhone)
        .refine((v) => PHONE.test(v), "Use international format with country code, e.g. +31 6 1234 5678"),
      tin: optional,
      tinMissingReason: optional,
      usTaxResident: yesNo("US tax resident"),
      pep: yesNo("politically exposed person"),
      declaration: checkbox.refine((v) => v, "Please confirm the declaration to continue"),
      deposit_12m: oneOf(ids(f.deposit_12m), "Expected deposit"),
      source_of_funds: oneOf(ids(f.source_of_funds), "Source of funds"),
      onlySourceOfWealth: checkbox,
      employment_status: oneOf(ids(f.employment_status), "Employment status"),
      occupation_industry: oneOf([...ids(f.occupation_industry.values), OTHER_OCCUPATION.id], "Industry"),
      occupationDetail: optional,
      annual_income: oneOf(ids(f.annual_income), "Annual income"),
      net_worth: oneOf(ids(f.net_worth), "Net worth"),
    })
    .superRefine((v, ctx) => {
      if (!v.tin && !v.tinMissingReason)
        ctx.addIssue({ code: "custom", path: ["tinMissingReason"], message: "Enter your TIN, or tell us briefly why you don't have one" });
      if (v.occupation_industry === OTHER_OCCUPATION.id && !v.occupationDetail)
        ctx.addIssue({ code: "custom", path: ["occupationDetail"], message: "Tell us your industry" });
    });
}

export type QuestionnaireAnswers = z.infer<ReturnType<typeof questionnaireSchema>>;
export type ResidenceFields = z.infer<ReturnType<typeof residenceFieldsSchema>>;
export type IdentityFields = z.infer<ReturnType<typeof identityFieldsSchema>>;

export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  return z.flattenError(error).fieldErrors as FieldErrors;
}

export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new PortalError("VALIDATION", "Please check the highlighted fields.", fieldErrorsOf(r.error));
  return r.data;
}
