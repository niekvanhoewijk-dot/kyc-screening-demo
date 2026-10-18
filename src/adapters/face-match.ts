export type FaceMatchInput = { selfie: Buffer; selfieName: string; poiFront: Buffer; poiFrontName: string };
export type FaceMatchResult = { provider: string; liveness: "pass" | "fail"; match: "pass" | "fail"; score: string };

/** Selfie liveness + face match against the POI picture. External supplier, not integrated (D5). */
export interface FaceMatchProvider {
  check(input: FaceMatchInput): Promise<FaceMatchResult>;
}

/**
 * Deterministic mock. Passes by default. For demos and tests, a selfie whose file name contains
 * "spoof" fails liveness and one containing "mismatch" fails the face match.
 */
export class MockFaceMatchProvider implements FaceMatchProvider {
  async check({ selfieName }: FaceMatchInput): Promise<FaceMatchResult> {
    const name = selfieName.toLowerCase();
    const liveness = name.includes("spoof") ? "fail" : "pass";
    const match = name.includes("mismatch") ? "fail" : "pass";
    return { provider: "mock-face-match", liveness, match, score: match === "pass" ? "0.97" : "0.31" };
  }
}
