import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";

export const CACHE_VERSION = "v4-flat-hovers";

export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

const dbMap = new Map<string, Client>();
const dbInitMap = new Map<string, Promise<void>>();

function getDatabase(customCacheDir?: string): Client {
  const cacheDir = customCacheDir
    ? path.resolve(process.cwd(), customCacheDir)
    : path.resolve(process.cwd(), "node_modules", ".cache", "leandown");

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const dbPath = path.join(cacheDir, "cache.db");
  const dbUrl = `file:${dbPath}`;
  
  let db = dbMap.get(dbPath);
  if (!db) {
    db = createClient({ url: dbUrl });
    dbMap.set(dbPath, db);
  }
  return db;
}

async function ensureDatabaseInitialized(customCacheDir?: string): Promise<Client> {
  const cacheDir = customCacheDir
    ? path.resolve(process.cwd(), customCacheDir)
    : path.resolve(process.cwd(), "node_modules", ".cache", "leandown");
  const dbPath = path.join(cacheDir, "cache.db");

  const db = getDatabase(customCacheDir);

  let initPromise = dbInitMap.get(dbPath);
  if (!initPromise) {
    initPromise = (async () => {
      await db.execute("PRAGMA journal_mode = WAL;");
      await db.execute("CREATE TABLE IF NOT EXISTS highlight_cache (key TEXT PRIMARY KEY, html TEXT);");
    })();
    dbInitMap.set(dbPath, initPromise);
  }
  await initPromise;
  return db;
}

export async function getCachedHighlight(hash: string, customCacheDir?: string): Promise<string | null> {
  const db = await ensureDatabaseInitialized(customCacheDir);
  const result = await db.execute({
    sql: "SELECT html FROM highlight_cache WHERE key = ?",
    args: [hash]
  });
  const row = result.rows[0];
  if (row) {
    return row.html as string;
  }
  return null;
}

export async function setCachedHighlight(hash: string, html: string, customCacheDir?: string): Promise<void> {
  const db = await ensureDatabaseInitialized(customCacheDir);
  await db.execute({
    sql: "INSERT OR REPLACE INTO highlight_cache (key, html) VALUES (?, ?)",
    args: [hash, html]
  });
}
