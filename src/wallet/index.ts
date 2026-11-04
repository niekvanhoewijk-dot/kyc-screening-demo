import type { Db } from "@/db/client";
import { loadWalletConfig, type WalletConfig } from "./config";
import { TestEcosystem, TestWallet } from "./test-wallet";
import { SdJwtWalletVerifier, type WalletVerifier } from "./verifier";

export type WalletKit = { config: WalletConfig; verifier: WalletVerifier; testWallet: TestWallet };

/** Wires the verifier to the built-in test ecosystem (the only mode there is, O-68). */
export function createWalletKit(db: Db, now: () => Date, config: WalletConfig = loadWalletConfig()): WalletKit {
  const eco = new TestEcosystem(config);
  return { config, verifier: new SdJwtWalletVerifier({ db, config, trust: eco.trustList, now }), testWallet: new TestWallet(eco, now) };
}

export { TEST_SCENARIOS, isTestScenario, type TestScenarioId } from "./test-wallet";
export type { WalletEvidence, WalletRequest, PidAttributes } from "./types";
export type { WalletVerifier } from "./verifier";
