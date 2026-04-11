import fs from "node:fs";
import path from "node:path";

function parseDotenv(src) {
  const out = {};
  const lines = String(src || "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;

    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out[key] = value;
  }

  return out;
}

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Loads dotenv-style files (if present) without overriding real environment variables.
 * Order: .env, .env.<mode>, .env.local, .env.<mode>.local
 */
export function loadEnv({ dir = process.cwd(), mode = process.env.NODE_ENV || "development" } = {}) {
  const envFiles = [
    path.join(dir, ".env"),
    path.join(dir, `.env.${mode}`),
    path.join(dir, ".env.local"),
    path.join(dir, `.env.${mode}.local`)
  ];

  const setByLoader = new Set();
  const loaded = [];

  for (const filePath of envFiles) {
    const src = readIfExists(filePath);
    if (src == null) continue;

    const isLocal = filePath.endsWith(".local");
    const parsed = parseDotenv(src);

    for (const [key, value] of Object.entries(parsed)) {
      const already = Object.prototype.hasOwnProperty.call(process.env, key);
      const canOverride = isLocal && setByLoader.has(key);
      if (!already || canOverride) {
        process.env[key] = value;
        setByLoader.add(key);
      }
    }

    loaded.push(filePath);
  }

  return { mode, loaded };
}

