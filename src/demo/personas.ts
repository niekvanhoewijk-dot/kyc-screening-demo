import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const PERSONA_DIR = path.resolve(/* turbopackIgnore: true */ process.cwd(), "fixtures/personas");

const address = z.object({ addressLine1: z.string(), city: z.string(), region: z.string(), postcode: z.string(), country: z.string(), countryName: z.string() });
const individual = z.object({
  id: z.string(),
  expect: z.object({ band: z.string(), total: z.number().optional(), threshold: z.number().optional(), forced_by: z.string().optional() }),
  story: z.string(),
  first: z.string(),
  last: z.string(),
  email: z.email(),
  dob: z.iso.date(),
  nationality: z.string(),
  sex: z.string(),
  address,
  porIssued: z.iso.date(),
  answers: z.record(z.string(), z.string()),
});
const schema = z.object({
  description: z.string(),
  individuals: z.array(individual),
  company: z.object({
    id: z.string(),
    expect: z.object({ band: z.string() }),
    story: z.string(),
    representative: z.object({ personaId: z.string(), email: z.email() }),
    company: z.record(z.string(), z.string()),
    representativeRoles: z.array(z.string()),
    representativeShare: z.string(),
    others: z.array(z.object({ id: z.string(), fullName: z.string(), dob: z.iso.date(), nationality: z.string(), roles: z.array(z.string()), share: z.string(), address })),
    documents: z.record(z.string(), z.string()),
  }),
});
export type Personas = z.infer<typeof schema>;
export type IndividualPersona = Personas["individuals"][number];

export const loadPersonas = (): Personas => schema.parse(JSON.parse(fs.readFileSync(path.join(PERSONA_DIR, "personas.json"), "utf8")));

/** A fixture file as an upload. */
export function fixtureUpload(relative: string) {
  const file = path.resolve(PERSONA_DIR, relative);
  const bytes = fs.readFileSync(file);
  return { name: path.basename(file), type: "image/png", size: bytes.length, bytes };
}
