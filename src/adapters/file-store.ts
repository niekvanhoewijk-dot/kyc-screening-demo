import fs from "node:fs/promises";
import path from "node:path";

export interface FileStore {
  /** Returns a store-relative path. */
  save(caseId: string, fileName: string, bytes: Buffer): Promise<string>;
  read(storedPath: string): Promise<Buffer>;
}

/** Local disk under data/uploads (gitignored). Synthetic SAMPLE documents only. */
export class LocalFileStore implements FileStore {
  constructor(private readonly root = path.resolve(process.cwd(), "data/uploads")) {}

  async save(caseId: string, fileName: string, bytes: Buffer): Promise<string> {
    const rel = path.join(caseId, fileName);
    await fs.mkdir(path.join(this.root, caseId), { recursive: true });
    await fs.writeFile(path.join(this.root, rel), bytes);
    return rel;
  }

  async read(storedPath: string): Promise<Buffer> {
    const full = path.resolve(this.root, storedPath);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Path outside upload root");
    return fs.readFile(full);
  }
}
