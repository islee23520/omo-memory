import type Database from "better-sqlite3";
import type { ProjectContext } from "./types.js";

export type SourceSessionRow = {
  readonly id: string;
  readonly projectId: string;
  readonly host: string;
  readonly adapter: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly gitBranch: string | null;
  readonly gitHead: string | null;
};

export type SourceEventRow = {
  readonly id: string;
  readonly sessionId: string | null;
  readonly projectId: string;
  readonly type: string;
  readonly summary: string;
  readonly payloadJson: string | null;
  readonly createdAt: string;
};

export type SourceHandoffRow = {
  readonly id: string;
  readonly projectId: string;
  readonly sessionId: string | null;
  readonly summaryMd: string;
  readonly createdAt: string;
};

export function upsertAggregateProject(db: Database.Database, project: ProjectContext): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO projects (id, repo_root, git_remote, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET repo_root = excluded.repo_root, git_remote = excluded.git_remote, last_seen_at = excluded.last_seen_at
  `).run(project.id, project.repoRoot, project.gitRemote, now, now);
}

export function upsertCanonicalSession(db: Database.Database, sourceId: string, aggregateProjectId: string, row: SourceSessionRow): void {
  db.prepare(`
    INSERT INTO sessions (id, project_id, host, adapter, started_at, ended_at, git_branch, git_head)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET host = excluded.host, adapter = excluded.adapter, ended_at = excluded.ended_at, git_branch = excluded.git_branch, git_head = excluded.git_head
  `).run(globalRowId(sourceId, row.id), aggregateProjectId, row.host, row.adapter, row.startedAt, row.endedAt, row.gitBranch, row.gitHead);
}

export function upsertCanonicalEvent(db: Database.Database, sourceId: string, aggregateProjectId: string, row: SourceEventRow): void {
  db.prepare(`
    INSERT INTO events (id, session_id, project_id, type, summary, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, type = excluded.type, summary = excluded.summary, payload_json = excluded.payload_json, created_at = excluded.created_at
  `).run(
    globalRowId(sourceId, row.id),
    row.sessionId === null ? null : globalRowId(sourceId, row.sessionId),
    aggregateProjectId,
    row.type,
    row.summary,
    row.payloadJson,
    row.createdAt,
  );
}

export function upsertCanonicalHandoff(db: Database.Database, sourceId: string, aggregateProjectId: string, row: SourceHandoffRow): void {
  db.prepare(`
    INSERT INTO handoffs (id, project_id, session_id, summary_md, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, summary_md = excluded.summary_md, created_at = excluded.created_at
  `).run(globalRowId(sourceId, row.id), aggregateProjectId, row.sessionId === null ? null : globalRowId(sourceId, row.sessionId), row.summaryMd, row.createdAt);
}

function globalRowId(sourceId: string, sourceRowId: string): string {
  return `${sourceId}:${sourceRowId}`;
}
