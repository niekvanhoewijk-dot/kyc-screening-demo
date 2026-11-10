import { getDb, type Db } from "@/db/client";
import { ConsoleMailer, type Mailer } from "@/adapters/mailer";
import { MockFaceMatchProvider, type FaceMatchProvider } from "@/adapters/face-match";
import { LocalFileStore, type FileStore } from "@/adapters/file-store";
import { MockScreeningProvider, type ScreeningProvider } from "@/adapters/screening";
import { loadConsoleConfig, type ConsoleConfig } from "@/console/config";
import { checkRulesFromConfig, documentReaderFromEnv } from "@/documents/factory";
import type { PreReviewDeps } from "@/documents/pre-review";
import { loadEngineConfig, loadKybConfig, loadPolicies, type EngineConfig, type KybConfig, type PolicySet } from "@/engine";
import { createWalletKit, type WalletKit } from "@/wallet";
import { loadAgentConfig, type AgentConfig } from "@/agent/config";
import { loadPortalConfig, type PortalConfig } from "./config";

export type PortalDeps = {
  db: Db;
  mailer: Mailer;
  faceMatch: FaceMatchProvider;
  screening: ScreeningProvider;
  files: FileStore;
  /** Default policy (P1): labels and options. Scoring uses `policies.inForce(now)` (spec 08 5.5). */
  engine: EngineConfig;
  policies: PolicySet;
  portal: PortalConfig;
  kyb: KybConfig;
  consoleConfig: ConsoleConfig;
  /** ID wallet intake (spec 09): verifier plus the built-in test wallet. */
  wallet: WalletKit;
  /** Agent access (spec 10): tool limits and the leak guard's word list. */
  agent: AgentConfig;
  now: () => Date;
};

let deps: PreReviewDeps | undefined;

export function portalDeps(): PreReviewDeps {
  const db = getDb();
  const now = () => new Date();
  deps ??= {
    db,
    mailer: new ConsoleMailer(),
    faceMatch: new MockFaceMatchProvider(),
    screening: new MockScreeningProvider(),
    files: new LocalFileStore(),
    engine: loadEngineConfig(),
    policies: loadPolicies(),
    portal: loadPortalConfig(),
    kyb: loadKybConfig(),
    consoleConfig: loadConsoleConfig(),
    wallet: createWalletKit(db, now),
    agent: loadAgentConfig(),
    now,
    documentReader: (log) => documentReaderFromEnv(log),
    checkRules: checkRulesFromConfig(),
  };
  return deps;
}
