import type { EngineConfig } from "@/engine";

export const BAND_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High", auto_high: "Auto-High", prohibited: "Prohibited" };
export const STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  in_review: "In review",
  edd_requested: "EDD requested",
  edd_submitted: "EDD received",
  approved: "Approved",
  rejected: "Rejected",
  expired_por: "POR expired",
  draft: "Draft",
};
export const ROUTE_LABEL = { reject_recommended: "Engine: reject", edd_required: "Engine: EDD required", standard: "Standard review" } as const;

export const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** Human label for a questionnaire answer id, from config/risk-matrix.yaml. */
export function answerLabel(engine: EngineConfig, factor: string, id: string): string {
  const f = engine.matrix.factors[factor as keyof EngineConfig["matrix"]["factors"]];
  if (!f) return id;
  const list = Array.isArray(f) ? f : f.values;
  return list.find((v) => v.id === id)?.label ?? (id === "other" ? "Other" : id);
}
