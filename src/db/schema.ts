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
  kind: text("kind", { enum: ["poi_front", "poi_back", "selfie", "por"] }).notNull(),
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
  kind: text("kind", { enum: ["poi", "por"] }).notNull(),
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
