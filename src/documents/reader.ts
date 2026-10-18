import type { PoiExtraction, PorExtraction } from "./schemas";

export type DocumentKind = "poi" | "por";
export type DocumentInput = { bytes: Buffer; mime: string; sha256: string };

export type CallLog = {
  reader: string;
  kind: DocumentKind;
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
}
