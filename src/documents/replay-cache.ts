import fs from "node:fs";
import path from "node:path";

export type CacheRecord = {
  key: string;
  kind: string;
  model_requested: string;
  model: string;
  prompt_version: string;
  input_sha256: string;
  recorded_at: string;
  stop_reason: string | null;
  usage: unknown;
  output: unknown;
};

/**
 * Recorded Claude responses so the demo runs offline and deterministically (DEMO_MODE=replay).
 * Only real recorded responses belong here; never hand-write a record.
 */
export class ReplayCache {
  constructor(private readonly dir = path.resolve(/* turbopackIgnore: true */ process.cwd(), "fixtures/claude-cache")) {}

  private file(key: string) {
    return path.join(this.dir, `${key}.json`);
  }

  get(key: string): CacheRecord | null {
    try {
      return JSON.parse(fs.readFileSync(this.file(key), "utf8")) as CacheRecord;
    } catch {
      return null;
    }
  }

  put(record: CacheRecord) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(record.key), JSON.stringify(record, null, 2) + "\n");
  }
}
