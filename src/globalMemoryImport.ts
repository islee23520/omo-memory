import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import type {
  GlobalMemoryCounts,
  GlobalMemoryImportReport,
  GlobalMemoryList,
  GlobalMemorySource,
  MemoryDbCandidate,
  MemoryDbScanResult,
  SkippedMemoryDb,
} from "./globalMemory.js";
import {
  type SourceEventRow,
  type SourceHandoffRow,
  type SourceSessionRow,
  upsertAggregateProject,
  upsertCanonicalEvent,
  upsertCanonicalHandoff,
  upsertCanonicalSession,
} from "./globalMemoryCanonical.js";
import { redactSecrets, sanitizeGitRemote } from "./privacy.js";
import type { ProjectContext } from "./types.js";

type CountRow = { readonly count: number };
type MutableCounts = { sources: number; projects: number; sessions: number; events: number; handoffs: number };
type CandidateImport = { readonly kind: "imported"; readonly imported: GlobalMemoryCounts } | { readonly kind: "skipped"; readonly reason: string };
type SourceProjectRow = {
  readonly id: string;
  readonly repoRoot: string;
  readonly gitRemote: string | null;
  readonly createdAt: string;
  readonly lastSeenAt: string;
};
const GLOBAL_TABLES = ["sources", "global_projects", "global_sessions", "global_events", "global_handoffs"] as const;

export function importCandidates(globalDbPath: string, scan: MemoryDbScanResult, aggregateProject: ProjectContext): GlobalMemoryImportReport {
  const global = new Database(globalDbPath);
  const skipped: SkippedMemoryDb[] = [...scan.skipped];
  try {
    const before = readGlobalCounts(global);
    const imported: MutableCounts = { sources: 0, projects: 0, sessions: 0, events: 0, handoffs: 0 };
    for (const candidate of scan.candidates) {
      const result = importCandidate(global, candidate, aggregateProject);
      if (result.kind === "skipped") {
        skipped.push({ dbPath: candidate.dbPath, reason: result.reason });
      } else {
        imported.sources += result.imported.sources;
        imported.projects += result.imported.projects;
        imported.sessions += result.imported.sessions;
        imported.events += result.imported.events;
        imported.handoffs += result.imported.handoffs;
      }
    }
    return { sources: scan.candidates.length - (skipped.length - scan.skipped.length), imported, before, after: readGlobalCounts(global), skipped };
  } finally {
    global.close();
  }
}

export function listGlobalMemoryFromDb(globalDbPath: string): GlobalMemoryList {
  const db = new Database(globalDbPath, { readonly: true, fileMustExist: true });
  try {
    return {
      sources: db
        .prepare<[], GlobalMemorySource>(
          "SELECT id, db_path AS dbPath, schema_version AS schemaVersion, imported_at AS importedAt, last_seen_at AS lastSeenAt FROM sources ORDER BY db_path ASC",
        )
        .all(),
      counts: readGlobalCounts(db),
    };
  } finally {
    db.close();
  }
}

function importCandidate(global: Database.Database, candidate: MemoryDbCandidate, aggregateProject: ProjectContext): CandidateImport {
  let source: Database.Database;
  try {
    source = new Database(candidate.dbPath, { readonly: true, fileMustExist: true });
  } catch (error: unknown) {
    if (error instanceof Error) return { kind: "skipped", reason: error.message };
    throw error;
  }

  try {
    const sourceId = sourceIdForPath(candidate.dbPath);
    const now = new Date().toISOString();
    const rows = {
      projects: readProjects(source).map(redactProjectRow),
      sessions: readSessions(source),
      events: readEvents(source).map(redactEventRow),
      handoffs: readHandoffs(source).map(redactHandoffRow),
    };
    const write = global.transaction((): GlobalMemoryCounts => {
      const counts: MutableCounts = { sources: 0, projects: 0, sessions: 0, events: 0, handoffs: 0 };
      upsertAggregateProject(global, aggregateProject);
      counts.sources += global
        .prepare(
          "INSERT INTO sources (id, db_path, schema_version, imported_at, last_seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(db_path) DO UPDATE SET schema_version = excluded.schema_version, last_seen_at = excluded.last_seen_at",
        )
        .run(sourceId, candidate.dbPath, candidate.schemaVersion, now, now).changes;
      for (const row of rows.projects) counts.projects += upsertProject(global, sourceId, row);
      for (const row of rows.sessions) counts.sessions += upsertSession(global, sourceId, row);
      for (const row of rows.events) counts.events += upsertEvent(global, sourceId, row);
      for (const row of rows.handoffs) counts.handoffs += upsertHandoff(global, sourceId, row);
      for (const row of rows.sessions) upsertCanonicalSession(global, sourceId, aggregateProject.id, row);
      for (const row of rows.events) upsertCanonicalEvent(global, sourceId, aggregateProject.id, row);
      for (const row of rows.handoffs) upsertCanonicalHandoff(global, sourceId, aggregateProject.id, row);
      return counts;
    });
    return { kind: "imported", imported: write() };
  } catch (error: unknown) {
    if (error instanceof Error) return { kind: "skipped", reason: error.message };
    throw error;
  } finally {
    source.close();
  }
}

function readProjects(db: Database.Database): readonly SourceProjectRow[] {
  return db
    .prepare<[], SourceProjectRow>(
      "SELECT id, repo_root AS repoRoot, git_remote AS gitRemote, created_at AS createdAt, last_seen_at AS lastSeenAt FROM projects ORDER BY id ASC",
    )
    .all();
}

function readSessions(db: Database.Database): readonly SourceSessionRow[] {
  if (!tableExists(db, "sessions")) return [];
  return db
    .prepare<[], SourceSessionRow>(
      "SELECT id, project_id AS projectId, host, adapter, started_at AS startedAt, ended_at AS endedAt, git_branch AS gitBranch, git_head AS gitHead FROM sessions ORDER BY id ASC",
    )
    .all();
}

function readEvents(db: Database.Database): readonly SourceEventRow[] {
  return db
    .prepare<[], SourceEventRow>(
      "SELECT id, session_id AS sessionId, project_id AS projectId, type, summary, payload_json AS payloadJson, created_at AS createdAt FROM events ORDER BY id ASC",
    )
    .all();
}

function readHandoffs(db: Database.Database): readonly SourceHandoffRow[] {
  if (!tableExists(db, "handoffs")) return [];
  return db
    .prepare<[], SourceHandoffRow>(
      "SELECT id, project_id AS projectId, session_id AS sessionId, summary_md AS summaryMd, created_at AS createdAt FROM handoffs ORDER BY id ASC",
    )
    .all();
}

function upsertProject(db: Database.Database, sourceId: string, row: SourceProjectRow): number {
  return db
    .prepare(`
      INSERT INTO global_projects (id, source_id, source_project_id, repo_root, git_remote, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, source_project_id) DO UPDATE SET repo_root = excluded.repo_root, git_remote = excluded.git_remote, last_seen_at = excluded.last_seen_at
    `)
    .run(globalRowId(sourceId, row.id), sourceId, row.id, row.repoRoot, row.gitRemote ?? "", row.createdAt, row.lastSeenAt).changes;
}

function redactProjectRow(row: SourceProjectRow): SourceProjectRow {
  return { ...row, gitRemote: sanitizeGitRemote(row.gitRemote) };
}

function redactEventRow(row: SourceEventRow): SourceEventRow {
  return {
    ...row,
    summary: redactSecrets(row.summary),
    payloadJson: row.payloadJson === null ? null : redactSecrets(row.payloadJson),
  };
}

function redactHandoffRow(row: SourceHandoffRow): SourceHandoffRow {
  return { ...row, summaryMd: redactSecrets(row.summaryMd) };
}

function upsertSession(db: Database.Database, sourceId: string, row: SourceSessionRow): number {
  return db
    .prepare(`
      INSERT INTO global_sessions (id, source_id, source_session_id, source_project_id, host, adapter, started_at, ended_at, git_branch, git_head)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, source_session_id) DO UPDATE SET source_project_id = excluded.source_project_id, host = excluded.host, adapter = excluded.adapter, ended_at = excluded.ended_at, git_branch = excluded.git_branch, git_head = excluded.git_head
    `)
    .run(globalRowId(sourceId, row.id), sourceId, row.id, row.projectId, row.host, row.adapter, row.startedAt, row.endedAt, row.gitBranch, row.gitHead).changes;
}

function upsertEvent(db: Database.Database, sourceId: string, row: SourceEventRow): number {
  return db
    .prepare(`
      INSERT INTO global_events (id, source_id, source_event_id, source_session_id, source_project_id, type, summary, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, source_event_id) DO UPDATE SET source_session_id = excluded.source_session_id, source_project_id = excluded.source_project_id, type = excluded.type, summary = excluded.summary, payload_json = excluded.payload_json, created_at = excluded.created_at
    `)
    .run(globalRowId(sourceId, row.id), sourceId, row.id, row.sessionId ?? "", row.projectId, row.type, row.summary, row.payloadJson, row.createdAt).changes;
}

function upsertHandoff(db: Database.Database, sourceId: string, row: SourceHandoffRow): number {
  return db
    .prepare(`
      INSERT INTO global_handoffs (id, source_id, source_handoff_id, source_project_id, source_session_id, summary_md, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, source_handoff_id) DO UPDATE SET source_project_id = excluded.source_project_id, source_session_id = excluded.source_session_id, summary_md = excluded.summary_md, created_at = excluded.created_at
    `)
    .run(globalRowId(sourceId, row.id), sourceId, row.id, row.projectId, row.sessionId, row.summaryMd, row.createdAt).changes;
}

function readGlobalCounts(db: Database.Database): GlobalMemoryCounts {
  if (!GLOBAL_TABLES.every((tableName) => tableExists(db, tableName))) return { sources: 0, projects: 0, sessions: 0, events: 0, handoffs: 0 };
  return {
    sources: readGlobalCount(db, "sources"),
    projects: readGlobalCount(db, "global_projects"),
    sessions: readGlobalCount(db, "global_sessions"),
    events: readGlobalCount(db, "global_events"),
    handoffs: readGlobalCount(db, "global_handoffs"),
  };
}

function readGlobalCount(db: Database.Database, tableName: (typeof GLOBAL_TABLES)[number]): number {
  const row = db.prepare<[], CountRow>(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
  return row?.count ?? 0;
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db.prepare<[string], CountRow>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return row !== undefined && row.count === 1;
}

function sourceIdForPath(dbPath: string): string {
  return `src_${createHash("sha256").update(dbPath).digest("hex").slice(0, 24)}`;
}

function globalRowId(sourceId: string, sourceRowId: string): string {
  return `${sourceId}:${sourceRowId}`;
}
