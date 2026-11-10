import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
// Per-reason-code precision / recall over labelled documents (spec 06 "Evaluation"). Pure.

export type Labelled = { id: string; expected: string[]; fired: string[]; evaluated: boolean };
export type CodeStats = { code: string; tp: number; fp: number; fn: number; precision: number | null; recall: number | null; support: number };

export function perCodeStats(rows: Labelled[], codes: readonly string[]): CodeStats[] {
  const done = rows.filter((r) => r.evaluated);
  return codes
    .map((code) => {
      let tp = 0, fp = 0, fn = 0;
      for (const r of done) {
        const e = r.expected.includes(code), f = r.fired.includes(code);
        if (e && f) tp++;
        else if (f) fp++;
        else if (e) fn++;
      }
      return { code, tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null, support: tp + fn };
    })
    .filter((s) => s.tp + s.fp + s.fn > 0 || done.some((r) => r.expected.includes(s.code)));
}

export type Usage = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
export type Price = { input: number; output: number; cache_write: number; cache_read: number };

const PER_TOKEN = 1 / 1_000_000;

/** USD for one call from its recorded usage. Unknown model -> null (reported, not guessed). */
export function callCost(usage: Usage | null | undefined, price: Price | undefined): number | null {
  if (!usage || !price) return null;
  return (
    ((usage.input_tokens ?? 0) * price.input +
      (usage.output_tokens ?? 0) * price.output +
      (usage.cache_creation_input_tokens ?? 0) * price.cache_write +
      (usage.cache_read_input_tokens ?? 0) * price.cache_read) *
    PER_TOKEN
  );
}

/** config/claude-pricing.yaml: list prices per million tokens (cost reporting and the interviewer's spend cap). */
export function loadClaudePricing(file = path.resolve(/* turbopackIgnore: true */ process.cwd(), "config/claude-pricing.yaml")): { as_of: string; models: Record<string, Price> } {
  return parse(fs.readFileSync(file, "utf8")) as { as_of: string; models: Record<string, Price> };
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
