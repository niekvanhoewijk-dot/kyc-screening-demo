import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb } from "@/db/client";
import { MemoryMailer } from "@/adapters/mailer";
import { MockFaceMatchProvider } from "@/adapters/face-match";
import { LocalFileStore } from "@/adapters/file-store";
import { MockScreeningProvider } from "@/adapters/screening";
import { loadConsoleConfig } from "@/console/config";
import { loadEngineConfig, loadKybConfig } from "@/engine";
import { loadPortalConfig } from "@/portal/config";
import type { PortalDeps } from "@/portal/deps";
import type { UploadInput } from "@/portal/cases";

export function makeDeps(start = "2026-10-18T10:00:00Z") {
  const clock = { now: new Date(start) };
  const mailer = new MemoryMailer();
  const deps: PortalDeps = {
    db: createDb(":memory:"),
    mailer,
    faceMatch: new MockFaceMatchProvider(),
    screening: new MockScreeningProvider(),
    files: new LocalFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "kyc-uploads-"))),
    engine: loadEngineConfig(),
    portal: loadPortalConfig(),
    kyb: loadKybConfig(),
    consoleConfig: loadConsoleConfig(),
    now: () => clock.now,
  };
  const advance = (ms: number) => (clock.now = new Date(clock.now.getTime() + ms));
  const lastCode = () => /code is (\d+)/.exec(mailer.sent.at(-1)?.text ?? "")?.[1] ?? "";
  return { deps, mailer, clock, advance, lastCode };
}

export const file = (name: string, type = "image/png", bytes = Buffer.from(`SAMPLE ${name}`)): UploadInput => ({
  name,
  type,
  size: bytes.length,
  bytes,
});

export const account = (email = "ada.sample@example.test") => ({
  persona: "individual",
  firstName: "Ada",
  lastName: "Sample",
  email,
});

export const identityFields = { docType: "passport", issuingCountry: "GR", expiryDate: "2030-01-01" };

export const residenceFields = {
  addressLine1: "1 Sample Street",
  city: "Athens",
  region: "Attica",
  country: "GR",
  postcode: "10552",
  mobilePhone: "+30 690 000 0000",
  porType: "utility_bill",
};

export const questionnaire = {
  dateOfBirth: "1990-05-01",
  nationality: "GR",
  preferredLanguage: "en",
  phone: "+30 690 000 0000",
  tin: "SAMPLE-TIN-1",
  usTaxResident: "no",
  pep: "no",
  declaration: "on",
  deposit_12m: "lt_20k",
  source_of_funds: "salary",
  employment_status: "employed",
  occupation_industry: "it",
  annual_income: "lt_50k",
  net_worth: "lt_50k",
};
