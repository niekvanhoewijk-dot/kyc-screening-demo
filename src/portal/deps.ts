import { getDb, type Db } from "@/db/client";
import { ConsoleMailer, type Mailer } from "@/adapters/mailer";
import { MockFaceMatchProvider, type FaceMatchProvider } from "@/adapters/face-match";
import { LocalFileStore, type FileStore } from "@/adapters/file-store";
import { loadEngineConfig, type EngineConfig } from "@/engine";
import { loadPortalConfig, type PortalConfig } from "./config";
import { checkRulesFromConfig, documentReaderFromEnv } from "@/documents/factory";
import type { PreReviewDeps } from "@/documents/pre-review";

export type PortalDeps = {
  db: Db;
  mailer: Mailer;
  faceMatch: FaceMatchProvider;
  files: FileStore;
  engine: EngineConfig;
  portal: PortalConfig;
  now: () => Date;
};

let deps: PreReviewDeps | undefined;

export function portalDeps(): PreReviewDeps {
  deps ??= {
    db: getDb(),
    mailer: new ConsoleMailer(),
    faceMatch: new MockFaceMatchProvider(),
    files: new LocalFileStore(),
    engine: loadEngineConfig(),
    portal: loadPortalConfig(),
    now: () => new Date(),
    documentReader: (log) => documentReaderFromEnv(log),
    checkRules: checkRulesFromConfig(),
  };
  return deps;
}
