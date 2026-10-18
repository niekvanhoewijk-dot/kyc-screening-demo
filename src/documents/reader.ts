import type { KybClassification, MemoDraft } from "./kyb-schemas";
import type { PoiExtraction, PorExtraction } from "./schemas";

export type DocumentKind = "poi" | "por" | "kyb";
export type CallKind = DocumentKind | "memo";
export type DocumentInput = { bytes: Buffer; mime: string; sha256: string };

export type CallLog = {
  reader: string;
  kind: CallKind;
  source: "live" | "replay";
  modelRequested: string;
  model: string | null; // model that actually answered (may differ after a refusal fallback)
  promptVersion: string;
  inputHash: string;
  attempt: number;
  stopReason: string | null;
  usage: unknown;
  outcome: "ok" | "invalid" | "refusal" | "error" | "replay_miss";
  detail?: string;
  output?: unknown;
};

export type ReadOutcome<T> =
  | { status: "ok"; extraction: T; calls: CallLog[] }
  | { status: "failed"; error: string; calls: CallLog[] };

/**
 * Reads a document into structured fields. Claude is one implementation (CLAUDE.md:
 * vendor-style adapters). Readers extract and report; they never score or decide.
 */
export interface DocumentReader {
  readPoi(doc: DocumentInput): Promise<ReadOutcome<PoiExtraction>>;
  readPor(doc: DocumentInput): Promise<ReadOutcome<PorExtraction>>;
  /** spec 03/06: classify a company document into checklist items 3-13 and extract company data. */
  readKyb(doc: DocumentInput): Promise<ReadOutcome<KybClassification>>;
}

/** Drafts the analyst-facing case memo from facts the engine and rule checks produced. */
export interface MemoWriter {
  draftMemo(facts: unknown): Promise<ReadOutcome<MemoDraft>>;
}
