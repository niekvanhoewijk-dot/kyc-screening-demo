import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { parse } from "yaml";

// Server actions carry the uploads; size the body limit from config/portal.yaml.
// The identity step sends the most files at once (POI front, back, selfie).
const portal = parse(fs.readFileSync(path.join(process.cwd(), "config/portal.yaml"), "utf8"));
const FILES_PER_STEP = 3;
const bodyLimitMb = Math.ceil((portal.uploads.max_bytes * FILES_PER_STEP) / (1024 * 1024)) + 1;

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: { bodySizeLimit: `${bodyLimitMb}mb` },
  },
};

export default nextConfig;
