import fs from "node:fs";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Separate runner for live recording (npm run docs:record). Never part of `npm run test`.
// Loads .env.local the way Next does, so the same key works for both.
const local = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "";
const fromFile = Object.fromEntries(
  local
    .split("\n")
    .map((l) => /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m && m[2] !== "")
    .map((m) => [m[1], m[2]!.replace(/^["']|["']$/g, "")]),
);

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { environment: "node", include: ["tools/record/**/*.record.ts"], env: fromFile },
});
