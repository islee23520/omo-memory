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

    CREATE TABLE IF NOT EXISTS concepts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      payload_json TEXT NOT NULL DEFAULT '{}',
      valid_from TEXT,
      valid_to TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_concepts_project_kind ON concepts(project_id, kind);
    CREATE INDEX IF NOT EXISTS idx_concepts_project_label ON concepts(project_id, label);
    CREATE INDEX IF NOT EXISTS idx_concepts_valid_to ON concepts(project_id, valid_to);

    CREATE TABLE IF NOT EXISTS durable_memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT,
      source_event_id TEXT,
      source_handoff_id TEXT,
      confidence REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      valid_from TEXT,
      valid_to TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(source_event_id) REFERENCES events(id),
      FOREIGN KEY(source_handoff_id) REFERENCES handoffs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_durable_memories_project_type ON durable_memories(project_id, type);
    CREATE INDEX IF NOT EXISTS idx_durable_memories_project_status ON durable_memories(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_durable_memories_source_event ON durable_memories(source_event_id);

    CREATE TABLE IF NOT EXISTS decision_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      rationale TEXT NOT NULL,
      alternatives_json TEXT NOT NULL DEFAULT '[]',
      evidence_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      reversible INTEGER NOT NULL DEFAULT 1,
      source_event_id TEXT,
      supersedes_decision_id TEXT,
      valid_from TEXT,
      valid_to TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(source_event_id) REFERENCES events(id),
      FOREIGN KEY(supersedes_decision_id) REFERENCES decision_records(id)
    );
    CREATE INDEX IF NOT EXISTS idx_decision_records_project_status ON decision_records(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_decision_records_source_event ON decision_records(source_event_id);

    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}',
      valid_from TEXT,
      valid_to TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_relations_project_source ON relations(project_id, source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_relations_project_target ON relations(project_id, target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_relations_project_relation ON relations(project_id, relation);

    CREATE TABLE IF NOT EXISTS memory_references (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      ref_kind TEXT NOT NULL DEFAULT 'mentions',
      weight REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_references_project_source ON memory_references(project_id, source_type, source_id);
  `);

  // schema v3 upgrade: add retention/reference columns to existing v1/v2 DBs (idempotent)
  const addCol = (sql: string) => {
    try {
      db.exec(sql);
    } catch (e: unknown) {
      const m = String((e as Error).message || e);
      if (!/duplicate column name|already exists/i.test(m)) throw e;
    }
  };
  addCol("ALTER TABLE concepts ADD COLUMN score REAL NOT NULL DEFAULT 0");
  addCol("ALTER TABLE concepts ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'working'");
  addCol("ALTER TABLE concepts ADD COLUMN manual_pin INTEGER NOT NULL DEFAULT 0");
  addCol("ALTER TABLE concepts ADD COLUMN ref_count INTEGER NOT NULL DEFAULT 0");
  addCol("ALTER TABLE concepts ADD COLUMN project_spread INTEGER NOT NULL DEFAULT 1");
  addCol("ALTER TABLE concepts ADD COLUMN first_seen TEXT");
  addCol("ALTER TABLE concepts ADD COLUMN last_seen TEXT");
  addCol("ALTER TABLE durable_memories ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'durable'");
  compactMemoryReferences(db);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_references_unique_edge ON memory_references(
      project_id, source_type, source_id, target_type, target_id, ref_kind
    )
  `);
  recomputeConceptReferenceCounts(db);
  db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
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
