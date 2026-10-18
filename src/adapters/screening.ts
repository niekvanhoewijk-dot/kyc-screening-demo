import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export type ScreeningSubject = { fullName: string; dateOfBirth: string; countries: string[] };
export type ScreeningMatch = { nameSimilarity: number; dob: "match" | "year_only" | "differs"; country: "match" | "differs" };
export type ScreeningHit = {
  entryId: string;
  entryName: string;
  category: "sanctions" | "pep" | "adverse_media";
  program: string;
  match: ScreeningMatch;
  strength: "strong" | "possible";
};
export type ScreeningResult = { provider: string; listVersion: string; asOf: string; hits: ScreeningHit[] };

/** World-Check / OFAC-style screening (spec 02 section Screening). Hits are triaged by an analyst. */
export interface ScreeningProvider {
  screen(subject: ScreeningSubject): Promise<ScreeningResult>;
}

const settingsSchema = z.object({
  version: z.number(),
  provider: z.string(),
  name_similarity_min: z.number().gt(0).max(1),
  strong_name_similarity: z.number().gt(0).max(1),
});
const watchlistSchema = z.object({
  list_version: z.string(),
  as_of: z.iso.date(),
  entries: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      dob: z.iso.date(),
      country: z.string(),
      category: z.enum(["sanctions", "pep", "adverse_media"]),
      program: z.string(),
    }),
  ),
});

const normalise = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .sort()
    .join(" ");

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** 1 = identical after normalisation (case, accents, word order); 0 = nothing in common. */
export function nameSimilarity(a: string, b: string): number {
  const [x, y] = [normalise(a), normalise(b)];
  const longest = Math.max(x.length, y.length);
  return longest === 0 ? 0 : 1 - levenshtein(x, y) / longest;
}

/** Mock provider over the seeded fictional watchlist. Deterministic. */
export class MockScreeningProvider implements ScreeningProvider {
  private readonly settings = settingsSchema.parse(parse(fs.readFileSync(path.resolve(process.cwd(), "config/screening.yaml"), "utf8")));
  private readonly list = watchlistSchema.parse(parse(fs.readFileSync(path.resolve(process.cwd(), "fixtures/screening/watchlist.yaml"), "utf8")));

  async screen(subject: ScreeningSubject): Promise<ScreeningResult> {
    const s = this.settings;
    const hits: ScreeningHit[] = [];
    for (const e of this.list.entries) {
      const sim = nameSimilarity(subject.fullName, e.name);
      if (sim < s.name_similarity_min) continue;
      const dob = e.dob === subject.dateOfBirth ? "match" : e.dob.slice(0, "yyyy".length) === subject.dateOfBirth.slice(0, "yyyy".length) ? "year_only" : "differs";
      const country = subject.countries.includes(e.country) ? "match" : "differs";
      hits.push({
        entryId: e.id,
        entryName: e.name,
        category: e.category,
        program: e.program,
        match: { nameSimilarity: Math.round(sim * 100) / 100, dob, country },
        strength: sim >= s.strong_name_similarity && dob === "match" ? "strong" : "possible",
      });
    }
    return { provider: s.provider, listVersion: this.list.list_version, asOf: this.list.as_of, hits };
  }
}
