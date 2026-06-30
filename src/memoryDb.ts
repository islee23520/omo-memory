import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { defaultDbPath } from "./projectContext.js";

export const SCHEMA_VERSION = 3;

export function openMemoryDb(dbPath = defaultDbPath()): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      repo_root TEXT NOT NULL,
      git_remote TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      host TEXT NOT NULL,
      adapter TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      git_branch TEXT,
      git_head TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS handoffs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT,
      summary_md TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
  `);

  // Legacy ontology compatibility: existing DBs may contain ontology tables from schema v2/v3.
  // Do not create those tables for fresh DBs, but keep old DBs readable/purgeable.
  const addCol = (table: string, sql: string) => {
    if (!tableExists(db, table)) return;
    try {
      db.exec(sql);
    } catch (e: unknown) {
      const m = String((e as Error).message || e);
      if (!/duplicate column name|already exists/i.test(m)) throw e;
    }
  };
  addCol("concepts", "ALTER TABLE concepts ADD COLUMN score REAL NOT NULL DEFAULT 0");
  addCol("concepts", "ALTER TABLE concepts ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'working'");
  addCol("concepts", "ALTER TABLE concepts ADD COLUMN manual_pin INTEGER NOT NULL DEFAULT 0");
  addCol("concepts", "ALTER TABLE concepts ADD COLUMN ref_count INTEGER NOT NULL DEFAULT 0");
  addCol("concepts", "ALTER TABLE concepts ADD COLUMN project_spread INTEGER NOT NULL DEFAULT 1");
  addCol("concepts", "ALTER TABLE concepts ADD COLUMN first_seen TEXT");
  addCol("concepts", "ALTER TABLE concepts ADD COLUMN last_seen TEXT");
  addCol("concepts", "ALTER TABLE concepts ADD COLUMN valid_from TEXT");
  addCol("concepts", "ALTER TABLE concepts ADD COLUMN valid_to TEXT");
  addCol("relations", "ALTER TABLE relations ADD COLUMN valid_from TEXT");
  addCol("relations", "ALTER TABLE relations ADD COLUMN valid_to TEXT");
  addCol("durable_memories", "ALTER TABLE durable_memories ADD COLUMN source_handoff_id TEXT");
  addCol("durable_memories", "ALTER TABLE durable_memories ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'durable'");
  addCol("durable_memories", "ALTER TABLE durable_memories ADD COLUMN valid_from TEXT");
  addCol("durable_memories", "ALTER TABLE durable_memories ADD COLUMN valid_to TEXT");
  addCol("decision_records", "ALTER TABLE decision_records ADD COLUMN alternatives_json TEXT");
  addCol("decision_records", "ALTER TABLE decision_records ADD COLUMN evidence_json TEXT");
  addCol("decision_records", "ALTER TABLE decision_records ADD COLUMN reversible INTEGER");
  addCol("decision_records", "ALTER TABLE decision_records ADD COLUMN supersedes_decision_id TEXT");
  addCol("decision_records", "ALTER TABLE decision_records ADD COLUMN valid_from TEXT");
  addCol("decision_records", "ALTER TABLE decision_records ADD COLUMN valid_to TEXT");
  addCol("memory_references", "ALTER TABLE memory_references ADD COLUMN ref_kind TEXT NOT NULL DEFAULT 'mentions'");
  addCol("memory_references", "ALTER TABLE memory_references ADD COLUMN weight REAL NOT NULL DEFAULT 1");
  if (tableExists(db, "memory_references")) {
    compactMemoryReferences(db);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_references_unique_edge ON memory_references(
        project_id, source_type, source_id, target_type, target_id, ref_kind
      )
    `);
  }
  if (tableExists(db, "concepts") && tableExists(db, "memory_references")) {
    recomputeConceptReferenceCounts(db);
  }
  db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
}

export function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { readonly name: string } | undefined;
  return row !== undefined;
}

function compactMemoryReferences(db: Database.Database): void {
  db.exec(`
    DELETE FROM memory_references
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM memory_references
      GROUP BY project_id, source_type, source_id, target_type, target_id, ref_kind
    )
  `);
}

function recomputeConceptReferenceCounts(db: Database.Database): void {
  db.exec(`
    UPDATE concepts
       SET ref_count = (
         SELECT COUNT(*)
           FROM memory_references
          WHERE memory_references.project_id = concepts.project_id
            AND memory_references.target_type = 'concept'
            AND memory_references.target_id = concepts.id
       )
  `);
}

export function initMemory(dbPath = defaultDbPath()): { readonly dbPath: string; readonly schemaVersion: number } {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    return { dbPath, schemaVersion: SCHEMA_VERSION };
  } finally {
    db.close();
  }
}
