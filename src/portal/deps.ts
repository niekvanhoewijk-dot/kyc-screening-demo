import { getDb, type Db } from "@/db/client";
import { ConsoleMailer, type Mailer } from "@/adapters/mailer";
import { MockFaceMatchProvider, type FaceMatchProvider } from "@/adapters/face-match";
import { LocalFileStore, type FileStore } from "@/adapters/file-store";
import { MockScreeningProvider, type ScreeningProvider } from "@/adapters/screening";
import { loadConsoleConfig, type ConsoleConfig } from "@/console/config";
import { checkRulesFromConfig, documentReaderFromEnv } from "@/documents/factory";
import type { PreReviewDeps } from "@/documents/pre-review";
import { loadEngineConfig, loadKybConfig, type EngineConfig, type KybConfig } from "@/engine";
import { loadPortalConfig, type PortalConfig } from "./config";

export type PortalDeps = {
  db: Db;
  mailer: Mailer;
  faceMatch: FaceMatchProvider;
  screening: ScreeningProvider;
  files: FileStore;
  engine: EngineConfig;
  portal: PortalConfig;
  kyb: KybConfig;
  consoleConfig: ConsoleConfig;
  now: () => Date;
};

let deps: PreReviewDeps | undefined;

export function portalDeps(): PreReviewDeps {
  deps ??= {
    db: getDb(),
    mailer: new ConsoleMailer(),
    faceMatch: new MockFaceMatchProvider(),
    screening: new MockScreeningProvider(),
    files: new LocalFileStore(),
    engine: loadEngineConfig(),
    portal: loadPortalConfig(),
    kyb: loadKybConfig(),
    consoleConfig: loadConsoleConfig(),
    now: () => new Date(),
    documentReader: (log) => documentReaderFromEnv(log),
    checkRules: checkRulesFromConfig(),
  };
  return deps;
}
