import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Phase 0 smoke test: the golden contract is present and well-formed.
// Engine assertions against these cases arrive in Phase 1.
const dir = path.resolve(__dirname);
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("golden files", () => {
  it("exist", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} has well-formed cases`, () => {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      expect(Array.isArray(data.cases)).toBe(true);
      expect(data.cases.length).toBeGreaterThan(0);
      const ids = new Set<string>();
      for (const c of data.cases) {
        expect(typeof c.id).toBe("string");
        expect(c.input).toBeTypeOf("object");
        expect(c.expect).toBeTypeOf("object");
        expect(ids.has(c.id)).toBe(false);
        ids.add(c.id);
      }
    });
  }
});
