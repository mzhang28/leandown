import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";

export const CACHE_VERSION = "v3-permalinks";

export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

const dbMap = new Map<string, Database>();

function getDatabase(customCacheDir?: string): Database {
  const cacheDir = customCacheDir
    ? path.resolve(process.cwd(), customCacheDir)
    : path.resolve(process.cwd(), "node_modules", ".cache", "remark-lean");

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const dbPath = path.join(cacheDir, "cache.db");
  
  let db = dbMap.get(dbPath);
  if (!db) {
    db = new Database(dbPath);
    db.run("PRAGMA journal_mode = WAL;");
    db.run("CREATE TABLE IF NOT EXISTS highlight_cache (key TEXT PRIMARY KEY, html TEXT);");
    dbMap.set(dbPath, db);
  }
  return db;
}

export function getCachedHighlight(hash: string, customCacheDir?: string): string | null {
  const db = getDatabase(customCacheDir);
  const row = db.query("SELECT html FROM highlight_cache WHERE key = $key").get({ $key: hash }) as { html: string } | null;
  return row ? row.html : null;
}

export function setCachedHighlight(hash: string, html: string, customCacheDir?: string) {
  const db = getDatabase(customCacheDir);
  db.query("INSERT OR REPLACE INTO highlight_cache (key, html) VALUES ($key, $html)").run({ $key: hash, $html: html });
}
