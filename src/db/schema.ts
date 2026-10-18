import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Every state change, Claude call and analyst action lands here (CLAUDE.md: audit trail on everything).
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: text("ts").notNull(), // ISO 8601, UTC
  actor: text("actor").notNull(), // e.g. "applicant:<id>", "analyst:<id>", "system", "claude"
  action: text("action").notNull(),
  entity: text("entity"), // e.g. "case:<id>"
  payload: text("payload", { mode: "json" }),
});

export const applicants = sqliteTable("applicants", {
  id: text("id").primaryKey(),
  persona: text("persona", { enum: ["individual", "company"] }).notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(), // stored lower-cased
  emailVerifiedAt: text("email_verified_at"),
  createdAt: text("created_at").notNull(),
});

export const otpChallenges = sqliteTable("otp_challenges", {
  id: text("id").primaryKey(),
  applicantId: text("applicant_id").notNull().references(() => applicants.id),
  codeHash: text("code_hash").notNull(), // the code itself is never stored or audited
  expiresAt: text("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  applicantId: text("applicant_id").notNull().references(() => applicants.id),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const CASE_STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "edd_requested",
  "edd_submitted",
  "approved",
  "rejected",
  "expired_por",
] as const;

export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(),
  applicantId: text("applicant_id").notNull().references(() => applicants.id),
  persona: text("persona", { enum: ["individual", "company"] }).notNull(),
  status: text("status", { enum: CASE_STATUSES }).notNull(),
  // Step data, validated by Zod in src/portal before it is written.
  identity: text("identity", { mode: "json" }),
  residence: text("residence", { mode: "json" }),
  questionnaire: text("questionnaire", { mode: "json" }),
  overviewSeenAt: text("overview_seen_at"),
  // Engine output, never shown to the applicant.
  riskResult: text("risk_result", { mode: "json" }),
  thresholdResult: text("threshold_result", { mode: "json" }),
  // Claude pre-review (MVP 2): rule checks over document extractions. Advisory, analyst-facing only.
  preReview: text("pre_review", { mode: "json" }),
  // EDD (docs/spec/05): what was asked, what the applicant sent, and the engine recalculation.
  eddRequest: text("edd_request", { mode: "json" }),
  eddSubmission: text("edd_submission", { mode: "json" }),
  eddResult: text("edd_result", { mode: "json" }),
  // Company cases (spec 03): company details and corporate questionnaire.
  company: text("company", { mode: "json" }),
  persons: text("persons_step", { mode: "json" }), // step completion marker for the persons step
  companyDocs: text("company_docs_step", { mode: "json" }),
  // Claude case memo (spec 06 CaseMemo). Advisory, analyst-facing only.
  memo: text("memo", { mode: "json" }),
  engineVersions: text("engine_versions", { mode: "json" }),
  decision: text("decision", { enum: ["approve", "reject", "edd"] }),
  decisionReason: text("decision_reason"),
  decidedBy: text("decided_by"),
  decidedAt: text("decided_at"),
  submittedAt: text("submitted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  kind: text("kind", { enum: ["poi_front", "poi_back", "selfie", "por", "sof", "edd_kyc", "company_doc", "person_poi", "person_por"] }).notNull(),
  personId: text("person_id"), // company cases: whose POI/POR this is
  docType: text("doc_type"),
  originalName: text("original_name").notNull(),
  storedPath: text("stored_path").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  supersededAt: text("superseded_at"), // re-uploads keep the old row for the audit trail
  uploadedAt: text("uploaded_at").notNull(),
});

export const faceMatches = sqliteTable("face_matches", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  selfieDocumentId: text("selfie_document_id").notNull().references(() => documents.id),
  provider: text("provider").notNull(),
  liveness: text("liveness", { enum: ["pass", "fail"] }).notNull(),
  match: text("match", { enum: ["pass", "fail"] }).notNull(),
  score: text("score"), // provider-reported similarity, stored as given
  createdAt: text("created_at").notNull(),
});

export const documentReadings = sqliteTable("document_readings", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  documentId: text("document_id").notNull().references(() => documents.id),
  kind: text("kind", { enum: ["poi", "por", "kyb"] }).notNull(),
  status: text("status", { enum: ["ok", "failed"] }).notNull(),
  extraction: text("extraction", { mode: "json" }),
  error: text("error"),
  reader: text("reader").notNull(),
  model: text("model"),
  promptVersion: text("prompt_version").notNull(),
  inputHash: text("input_hash").notNull(),
  source: text("source", { enum: ["live", "replay"] }).notNull(),
  createdAt: text("created_at").notNull(),
});

export const screeningHits = sqliteTable("screening_hits", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  subject: text("subject"), // company cases: "company" or a person id; null = the individual applicant
  provider: text("provider").notNull(),
  listVersion: text("list_version").notNull(),
  entryId: text("entry_id").notNull(),
  entryName: text("entry_name").notNull(),
  category: text("category", { enum: ["sanctions", "pep", "adverse_media"] }).notNull(),
  program: text("program").notNull(),
  match: text("match", { mode: "json" }).notNull(), // name similarity, DOB and country comparison
  strength: text("strength", { enum: ["strong", "possible"] }).notNull(),
  status: text("status", { enum: ["open", "false_positive", "true_match"] }).notNull(),
  triagedBy: text("triaged_by"),
  triageReason: text("triage_reason"),
  triagedAt: text("triaged_at"),
  createdAt: text("created_at").notNull(),
});

/** Demo-wide settings, e.g. the MVP 1 / MVP 2 mode. Changes are audited. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});

/** Natural persons on a company case (spec 03): representative, UBOs, shareholders, board members. */
export const casePersons = sqliteTable("case_persons", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  fullName: text("full_name").notNull(),
  dateOfBirth: text("date_of_birth").notNull(),
  nationality: text("nationality").notNull(),
  countryOfResidence: text("country_of_residence").notNull(),
  roles: text("roles", { mode: "json" }).notNull(), // PersonRole[]
  sharePercent: text("share_percent"), // decimal string as declared, null if not a shareholder
  pep: integer("pep", { mode: "boolean" }).notNull(),
  isApplicant: integer("is_applicant", { mode: "boolean" }).notNull(), // the representative using the portal
  createdAt: text("created_at").notNull(),
});
