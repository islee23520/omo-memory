import type { Dirent } from "node:fs";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { importCandidates, listGlobalMemoryFromDb } from "./globalMemoryImport.js";
import { migrate } from "./memoryDb.js";
import { resolveProjectContext } from "./projectContext.js";

export type GlobalMemoryInitResult = { readonly dbPath: string };
export type MemoryDbCandidate = {
  readonly dbPath: string;
  readonly schemaVersion: number;
  readonly projectCount: number;
  readonly eventCount: number;
};
export type SkippedMemoryDb = { readonly dbPath: string; readonly reason: string };
export type MemoryDbScanResult = {
  readonly candidates: readonly MemoryDbCandidate[];
  readonly skipped: readonly SkippedMemoryDb[];
};
export type GlobalMemoryCounts = {
  readonly sources: number;
  readonly projects: number;
  readonly sessions: number;
  readonly events: number;
  readonly handoffs: number;
};
export type GlobalMemorySource = {
  readonly id: string;
  readonly dbPath: string;
  readonly schemaVersion: number;
  readonly importedAt: string;
  readonly lastSeenAt: string;
};
export type GlobalMemoryList = {
  readonly sources: readonly GlobalMemorySource[];
  readonly counts: GlobalMemoryCounts;
};
export type GlobalMemoryImportReport = {
  readonly sources: number;
  readonly imported: GlobalMemoryCounts;
  readonly before: GlobalMemoryCounts;
  readonly after: GlobalMemoryCounts;
  readonly skipped: readonly SkippedMemoryDb[];
};

type CountRow = { readonly count: number };
type SchemaVersionRow = { readonly value: string };
type SourceScan = { readonly kind: "candidate"; readonly candidate: MemoryDbCandidate } | { readonly kind: "skipped"; readonly reason: string };

const STATE_DB_SUFFIX = join(".omo", "memory", "state.sqlite");
const REQUIRED_TABLES = ["schema_meta", "projects", "events"] as const;

export function initGlobalMemory(globalDbPath: string): GlobalMemoryInitResult {
  mkdirSync(dirname(globalDbPath), { recursive: true });
  const db = new Database(globalDbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        db_path TEXT UNIQUE NOT NULL,
        schema_version INTEGER NOT NULL,
        imported_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS global_projects (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_project_id TEXT NOT NULL,
        repo_root TEXT NOT NULL,
        git_remote TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE(source_id, source_project_id)
      );
      CREATE TABLE IF NOT EXISTS global_sessions (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_session_id TEXT NOT NULL,
        source_project_id TEXT NOT NULL,
        host TEXT NOT NULL,
        adapter TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        git_branch TEXT,
        git_head TEXT,
        UNIQUE(source_id, source_session_id)
      );
      CREATE TABLE IF NOT EXISTS global_events (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        source_session_id TEXT NOT NULL,
        source_project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(source_id, source_event_id)
      );
      CREATE TABLE IF NOT EXISTS global_handoffs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_handoff_id TEXT NOT NULL,
        source_project_id TEXT NOT NULL,
        source_session_id TEXT,
        summary_md TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(source_id, source_handoff_id)
      );
    `);
    migrate(db);
    return { dbPath: globalDbPath };
  } finally {
    db.close();
  }
}

export function scanForMemoryDbs(rootPath: string): MemoryDbScanResult {
  const candidates: MemoryDbCandidate[] = [];
  const skipped: SkippedMemoryDb[] = [];
  for (const dbPath of findStateDbs(rootPath)) {
    const scan = scanSourceDb(dbPath);
    if (scan.kind === "candidate") candidates.push(scan.candidate);
    else skipped.push({ dbPath, reason: scan.reason });
  }
  return { candidates, skipped };
}

export function migrateToGlobalMemory(input: { readonly rootPath: string; readonly globalDbPath: string }): GlobalMemoryImportReport {
  const scan = scanForMemoryDbs(input.rootPath);
  initGlobalMemory(input.globalDbPath);
  return importCandidates(input.globalDbPath, scan, resolveProjectContext());
}

export function listGlobalMemory(globalDbPath: string): GlobalMemoryList {
  return listGlobalMemoryFromDb(globalDbPath);
}

function findStateDbs(rootPath: string): readonly string[] {
  const dbPaths: string[] = [];
  const visit = (path: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(path, { withFileTypes: true });
    } catch (error: unknown) {
      if (error instanceof Error) return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entryPath.endsWith(STATE_DB_SUFFIX)) dbPaths.push(entryPath);
    }
  };
  visit(rootPath);
  return dbPaths.sort();
}

function scanSourceDb(dbPath: string): SourceScan {
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (error: unknown) {
    if (error instanceof Error) return { kind: "skipped", reason: error.message };
    throw error;
  }
  try {
    for (const tableName of REQUIRED_TABLES) {
      if (!tableExists(db, tableName)) return { kind: "skipped", reason: `missing table ${tableName}` };
    }
    return {
      kind: "candidate",
      candidate: { dbPath, schemaVersion: readSchemaVersion(db), projectCount: readCount(db, "projects"), eventCount: readCount(db, "events") },
    };
  } catch (error: unknown) {
    if (error instanceof Error) return { kind: "skipped", reason: error.message };
    throw error;
  } finally {
    db.close();
  }
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db.prepare<[string], CountRow>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return row !== undefined && row.count === 1;
}

function readSchemaVersion(db: Database.Database): number {
  const row = db
    .prepare<[], SchemaVersionRow>(
      "SELECT value FROM schema_meta WHERE key IN ('schema_version', 'version') ORDER BY CASE key WHEN 'schema_version' THEN 0 ELSE 1 END LIMIT 1",
    )
    .get();
  if (row === undefined) return 0;
  const parsed = Number.parseInt(row.value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readCount(db: Database.Database, tableName: "projects" | "events"): number {
  const row = db.prepare<[], CountRow>(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
  return row?.count ?? 0;
}
