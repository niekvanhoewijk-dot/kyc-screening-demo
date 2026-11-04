#!/usr/bin/env node
// npm run preflight  -> readiness check before an interview. Dependency-free, read-only
// (except: creates .env.local from .env.example if it is missing).
// Exit code 1 only for blockers (the app cannot start); warnings never block `npm run demo`.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const root = process.cwd();
const at = (p) => path.join(root, p);
const results = [];
const ok = (m) => results.push(["ok", m]);
const warn = (m, fix) => results.push(["warn", m, fix]);
const fail = (m, fix) => results.push(["fail", m, fix]);

// 1. Node version
const major = Number(process.versions.node.split(".")[0]);
major >= 20 ? ok(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node} is too old (need 20+)`, "Install a current Node.js LTS");

// 2. Dependencies installed
fs.existsSync(at("node_modules/next")) ? ok("Dependencies installed") : fail("Dependencies not installed", "npm install");

// 3. .env.local (auto-created from the example so replay mode works out of the box)
if (!fs.existsSync(at(".env.local"))) {
  if (fs.existsSync(at(".env.example"))) {
    fs.copyFileSync(at(".env.example"), at(".env.local"));
    ok("Created .env.local from .env.example (DEMO_MODE=replay, no API key needed)");
  } else fail(".env.local and .env.example are both missing", "Restore .env.example from git");
} else ok(".env.local present");

const env = {};
if (fs.existsSync(at(".env.local"))) {
  for (const line of fs.readFileSync(at(".env.local"), "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const mode = process.env.DEMO_MODE || env.DEMO_MODE || "replay";
mode === "replay"
  ? ok("DEMO_MODE=replay (offline: no API calls, no key needed)")
  : warn(`DEMO_MODE=${mode}: the app will call the Anthropic API and needs internet`, "Set DEMO_MODE=replay in .env.local for interviews");

// 4. Recorded Claude responses (needed for the MVP 2 panels)
let recorded = 0;
try { recorded = fs.readdirSync(at("fixtures/claude-cache")).filter((f) => f.endsWith(".json")).length; } catch {}
recorded > 0
  ? ok(`${recorded} recorded Claude responses in fixtures/claude-cache`)
  : warn("No recorded Claude responses: MVP 2 panels (pre-review, memos) will show \"not recorded\"",
      "Put ANTHROPIC_API_KEY in .env.local, then run: npm run demo:record");
if (mode === "replay" && recorded === 0 && env.ANTHROPIC_API_KEY) ok("API key is set, so recording is possible");

// 5. Persona fixtures and proof-of-residence freshness
try {
  const p = JSON.parse(fs.readFileSync(at("fixtures/personas/personas.json"), "utf8"));
  const missing = [];
  for (const i of p.individuals ?? []) for (const k of ["poi", "por"]) {
    if (!fs.existsSync(at(`fixtures/personas/${i.id}-${k}.png`))) missing.push(`${i.id}-${k}.png`);
  }
  missing.length ? fail(`Missing persona documents: ${missing.join(", ")}`, "npm run docs:samples (macOS)") : ok(`${(p.individuals ?? []).length} individual personas and their documents present`);
  const now = new Date();
  for (const i of p.individuals ?? []) {
    if (!i.porIssued || /older than 3 mon/i.test(i.story ?? "")) continue; // stale on purpose for the demo
    const expires = new Date(i.porIssued);
    expires.setMonth(expires.getMonth() + 3);
    const days = Math.floor((expires - now) / 86400000);
    if (days < 0) warn(`${i.id}: proof of residence (${i.porIssued}) is now older than 3 months`, "Regenerate: see 'If something goes wrong' in docs/DEMO-SCRIPT.md");
    else if (days <= 14) warn(`${i.id}: proof of residence turns older than 3 months in ${days} day(s)`, "Plan to regenerate (docs/DEMO-SCRIPT.md)");
  }
} catch (e) { fail(`Cannot read fixtures/personas/personas.json (${e.message})`); }

// 6. Policy versions and their country lists (spec 08): every file present, and what to say about the data
const today = new Date().toISOString().slice(0, 10);
try {
  const file = fs.readFileSync(at("config/policy/policies.yaml"), "utf8");
  const blocks = file.split(/\n\s*-\s+id:\s*/).slice(1);
  const policies = blocks.map((b) => ({
    id: /^"?([\w-]+)/.exec(b)?.[1],
    from: /effective_from:\s*"?([\d-]+)/.exec(b)?.[1],
    list: /country_list:\s*"?([^"\s#]+)/.exec(b)?.[1],
  }));
  if (!policies.length) fail("config/policy/policies.yaml lists no policies", "Restore it from git");
  for (const pol of policies) {
    const listFile = at(`config/${pol.list}`);
    if (!pol.list || !fs.existsSync(listFile)) { fail(`Policy ${pol.id}: country list ${pol.list ?? "(none)"} is missing`, "Restore config/ from git"); continue; }
    const c = fs.readFileSync(listFile, "utf8");
    pol.asOf = /as_of:\s*"?([\d-]+)/.exec(c)?.[1];
    pol.version = /list_version:\s*"?([\w-]+)/.exec(c)?.[1];
    ok(`Policy ${pol.id}: in force from ${pol.from}, ${pol.version}, FATF lists as of ${pol.asOf}`);
  }
  const inForce = policies.filter((x) => x.from && x.from <= today).sort((a, b) => a.from.localeCompare(b.from)).at(-1);
  if (inForce?.asOf) ok(`New applicants are scored under ${inForce.id}. Say "FATF, as of ${inForce.asOf}", not "current"`);
} catch (e) { fail(`Cannot read config/policy/policies.yaml (${e.message})`, "Restore it from git"); }

// 7. Synthetic book and pinned scenarios for the simulator (spec 08 sections 5.2 and 6)
try {
  const book = JSON.parse(fs.readFileSync(at("fixtures/portfolio/book.json"), "utf8"));
  const ids = (book.customers ?? []).map((c) => c.id);
  const unlabelled = (book.customers ?? []).filter((c) => c.label !== "Synthetic").map((c) => c.id);
  if (!ids.length) fail("fixtures/portfolio/book.json has no customers", "Restore it from git");
  else if (unlabelled.length) fail(`Book customers not labelled Synthetic: ${unlabelled.join(", ")}`, "Every book row must carry label: Synthetic");
  else if (new Set(ids).size !== ids.length) fail("fixtures/portfolio/book.json has duplicate customer ids", "Restore it from git");
  else ok(`Simulator book: ${ids.length} synthetic customers; presets move the simulated clock to the book's demo date ${book.demo_date}`);
} catch (e) { fail(`Cannot read fixtures/portfolio/book.json (${e.message})`, "Restore it from git"); }
try {
  const s = JSON.parse(fs.readFileSync(at("tests/golden/scenarios.json"), "utf8"));
  const scen = (s.cases ?? []).map((c) => c.id.split("-")[0]);
  const missing = ["S1", "S2", "S3", "S4", "S5"].filter((x) => !scen.includes(x));
  missing.length ? warn(`Pinned scenarios missing: ${missing.join(", ")}`, "Restore tests/golden/scenarios.json from git") : ok(`Scenarios S1 to S5 pinned (${scen.length} cases in tests/golden/scenarios.json)`);
} catch (e) { warn(`Cannot read tests/golden/scenarios.json (${e.message})`, "Restore it from git"); }

// 8. Design font: next/font fetches Alexandria from Google Fonts on the first compile. Offline it falls back to a
// system font (cosmetic only, the demo still runs), so start the app once while online before an interview.
fs.existsSync(at(".next"))
  ? ok("Build cache present (.next): fonts and pages compiled on an earlier start")
  : warn("No build cache yet: the first start fetches the Alexandria font from Google Fonts; offline it uses a system font (cosmetic only)",
      "Start the app once while online before the interview (npm run dev)");

// 9. Port 3000
const portFree = await new Promise((res) => {
  const s = net.createServer().once("error", () => res(false)).once("listening", () => s.close(() => res(true)));
  s.listen(3000, "127.0.0.1");
});
portFree ? ok("Port 3000 is free") : warn("Port 3000 is in use (another dev server?): Next will pick another port, check the URL it prints", "Close the old Terminal/server first");

// Report
const icon = { ok: "  OK    ", warn: "  WARN  ", fail: "  FAIL  " };
console.log("\nDemo preflight\n");
for (const [s, m, fix] of results) {
  console.log(icon[s] + m);
  if (fix) console.log("          -> " + fix);
}
const fails = results.filter((r) => r[0] === "fail").length;
const warns = results.filter((r) => r[0] === "warn").length;
console.log(`\n${fails ? "NOT READY" : warns ? "READY, with warnings" : "READY"}  (${fails} blocker(s), ${warns} warning(s))\n`);
process.exit(fails ? 1 : 0);
