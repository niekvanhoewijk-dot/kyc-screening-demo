import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { ClaudeDocumentReader, sdkParseCall } from "@/documents/claude-reader";
import { loadDocumentReadingConfig } from "@/documents/config";
import { evaluateDocument } from "@/documents/evaluate";
import { checkRulesFromConfig } from "@/documents/factory";
import { loadLabelledSet } from "@/documents/labelled-set";
import { REASON_CODES } from "@/documents/reason-codes";
import type { CallLog } from "@/documents/reader";
import { loadKybConfig } from "@/engine";
import type { PoiExtraction, PorExtraction } from "@/documents/schemas";
import { evaluateKybDocument, loadKybSet } from "./kyb-set";
import { callCost, mean, perCodeStats, type Price, type Usage } from "./metrics";

export type EvalOptions = {
  model: string;
  mode: "live" | "replay";
  clean: { poi: PoiExtraction; por: PorExtraction };
  outDir: string;
  now: Date;
  /** Tests inject a reader; normally built from model + mode. */
  reader?: (log: (c: CallLog) => void) => ClaudeDocumentReader;
};

/** Runs both labelled sets through reader + rule checks and writes reports/eval-<date>.{md,json}. */
export async function runEval(opts: EvalOptions) {
  const calls: CallLog[] = [];
  const config = loadDocumentReadingConfig();
  const log = (c: CallLog) => calls.push(c);
  const reader = opts.reader?.(log) ?? new ClaudeDocumentReader({ model: opts.model, mode: opts.mode, config, parse: opts.mode === "live" ? sdkParseCall() : undefined, log });
  const pricing = parse(fs.readFileSync(path.resolve(/* turbopackIgnore: true */ process.cwd(), "config/claude-pricing.yaml"), "utf8")) as { as_of: string; models: Record<string, Price> };

  const docSet = loadLabelledSet();
  const docRows = [];
  for (const d of docSet.documents) {
    const r = await evaluateDocument(reader, docSet, d, opts.clean, checkRulesFromConfig());
    docRows.push({ ...r, kind: d.kind, evaluated: r.status === "ok" });
  }
  const kybSet = loadKybSet();
  const kybRows = [];
  for (const d of kybSet.documents) {
    const r = await evaluateKybDocument(reader, kybSet, d, loadKybConfig());
    kybRows.push({ id: r.id, expected: r.expected, fired: r.fired, evaluated: r.status === "ok", expectedType: r.expectedType, type: r.type, status: r.status });
  }

  const all = [...docRows, ...kybRows];
  const stats = perCodeStats(all, REASON_CODES);
  const classified = kybRows.filter((r) => r.evaluated);
  const accuracy = classified.length ? classified.filter((r) => r.type === r.expectedType).length / classified.length : null;

  const ok = calls.filter((c) => c.outcome === "ok");
  const costOf = (c: CallLog) => callCost(c.usage as Usage, c.model ? pricing.models[c.model] : undefined);
  const costByKind = (kind: string) => mean(ok.filter((c) => c.kind === kind).map(costOf).filter((x): x is number => x !== null));
  const [poi, por, kyb] = [costByKind("poi"), costByKind("por"), costByKind("kyb")];
  const companyItems = loadKybConfig().checklist.filter((i) => !i.provided_by).length;
  const cost = {
    pricing_as_of: pricing.as_of,
    mean_per_call: { poi, por, kyb },
    individual_case: poi !== null && por !== null ? poi + por : null,
    company_case: poi !== null && por !== null && kyb !== null ? poi + por + companyItems * kyb : null,
    company_case_assumes_documents: companyItems,
    note: "Document reads only; the case memo is not in the labelled set. Replayed calls are priced from their recorded usage.",
  };

  const summary = {
    generated_at: opts.now.toISOString(),
    model: opts.model,
    prompt_version: config.prompt_version,
    mode: opts.mode,
    documents: { total: all.length, evaluated: all.filter((r) => r.evaluated).length, not_recorded: calls.filter((c) => c.outcome === "replay_miss").length },
    exact_match: all.filter((r) => r.evaluated && JSON.stringify(r.expected) === JSON.stringify(r.fired)).length,
    kyb_classification_accuracy: accuracy,
    per_code: stats,
    cost,
    rows: { documents: docRows.map(({ id, kind, expected, fired, status, error }) => ({ id, kind, expected, fired, status, error })), kyb: kybRows },
  };

  fs.mkdirSync(opts.outDir, { recursive: true });
  const stamp = opts.now.toISOString().slice(0, "yyyy-mm-ddThh-mm".length).replace(":", "-");
  const base = path.join(opts.outDir, `eval-${stamp}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2) + "\n");
  fs.writeFileSync(`${base}.md`, renderMarkdown(summary));
  return { summary, files: [`${base}.md`, `${base}.json`] };
}

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const usd = (x: number | null) => (x === null ? "n/a" : `$${x.toFixed(4)}`);

export function renderMarkdown(s: Awaited<ReturnType<typeof runEval>>["summary"]): string {
  const lines = [
    `# Document reading eval`,
    ``,
    `Generated ${s.generated_at} · model \`${s.model}\` · prompt \`${s.prompt_version}\` · mode ${s.mode}`,
    ``,
    `Illustrative demo on synthetic SAMPLE documents. Not evidence of production accuracy.`,
    ``,
    `- Documents evaluated: **${s.documents.evaluated} of ${s.documents.total}**${s.documents.not_recorded ? ` (${s.documents.not_recorded} without a recorded response: run \`npm run docs:record\`)` : ""}`,
    `- Exact match on reason codes: ${s.exact_match} of ${s.documents.evaluated}`,
    `- KYB classification accuracy: ${pct(s.kyb_classification_accuracy)}`,
    ``,
    `## Per reason code`,
    ``,
    `| Code | Support | TP | FP | FN | Precision | Recall |`,
    `|---|---|---|---|---|---|---|`,
    ...(s.per_code.length ? s.per_code.map((c) => `| ${c.code} | ${c.support} | ${c.tp} | ${c.fp} | ${c.fn} | ${pct(c.precision)} | ${pct(c.recall)} |`) : ["| (nothing evaluated) | | | | | | |"]),
    ``,
    `## Cost per case (pricing as of ${s.cost.pricing_as_of})`,
    ``,
    `- Mean per call: POI ${usd(s.cost.mean_per_call.poi)}, POR ${usd(s.cost.mean_per_call.por)}, company document ${usd(s.cost.mean_per_call.kyb)}`,
    `- Individual case (POI + POR): **${usd(s.cost.individual_case)}**`,
    `- Company case (representative POI + POR + ${s.cost.company_case_assumes_documents} company documents): **${usd(s.cost.company_case)}**`,
    `- ${s.cost.note}`,
    ``,
    `## Documents`,
    ``,
    `| Document | Expected | Fired | Status |`,
    `|---|---|---|---|`,
    ...[...s.rows.documents, ...s.rows.kyb].map((r) => `| ${r.id} | ${r.expected.join(", ") || "-"} | ${r.status === "ok" ? r.fired.join(", ") || "-" : "-"} | ${r.status === "ok" ? (JSON.stringify(r.expected) === JSON.stringify(r.fired) ? "match" : "differs") : "not evaluated"} |`),
    ``,
  ];
  return lines.join("\n");
}
