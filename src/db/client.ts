import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

/** Opens a database and applies pending migrations. ":memory:" for tests. */
export function createDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(/* turbopackIgnore: true */ process.cwd(), "drizzle") });
  return db;
}

// One connection per server process (survives Next dev hot reloads).
const globalForDb = globalThis as unknown as { kycDb?: Db };
export function getDb(): Db {
  globalForDb.kycDb ??= createDb(env.DATABASE_PATH);
  return globalForDb.kycDb;
}
