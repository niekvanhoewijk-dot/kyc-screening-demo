import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initialThreshold, loadEngineConfig, recalculateEdd, scoreApplicant } from "@/engine";

// The golden files are the contract (CLAUDE.md). Only the keys listed in `expect` are compared,
// exactly as tools/verify_golden.py does.
const config = loadEngineConfig();

const suites: Record<string, (input: never) => object> = {
  "risk-cases.json": (input) => scoreApplicant(input, config),
  "threshold-cases.json": (input) => initialThreshold(input, config),
  "edd-cases.json": (input) => recalculateEdd(input, config),
};

for (const [file, run] of Object.entries(suites)) {
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8")) as {
    cases: { id: string; input: never; expect: Record<string, unknown> }[];
  };

  describe(file, () => {
    for (const c of cases) {
      it(c.id, () => {
        const got = run(c.input) as Record<string, unknown>;
        const picked = Object.fromEntries(Object.keys(c.expect).map((k) => [k, got[k]]));
        expect(picked).toEqual(c.expect);
      });
    }
  });
}
