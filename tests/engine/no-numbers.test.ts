import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.md: no numbers in application code. Points, bands, caps and percentages live in config/.
// Allowed: 0 and 1 (indexing, counting) and the documented float tolerance in money.ts.
const dir = path.resolve("src/engine");

describe("src/engine has no business numbers", () => {
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    it(file, () => {
      const code = fs
        .readFileSync(path.join(dir, file), "utf8")
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""')
        .replace(/FLOAT_TOLERANCE = [0-9e.-]+/, "");
      const numbers = code.match(/(?<![\w.])\d+(?:\.\d+)?(?:e-?\d+)?(?![\w])/g) ?? [];
      expect(numbers.filter((n) => n !== "0" && n !== "1")).toEqual([]);
    });
  }
});
