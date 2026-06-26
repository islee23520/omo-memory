import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { migrate, openMemoryDb, SCHEMA_VERSION } from "./memoryDb.js";
import { redactSecrets } from "./privacy.js";
import { defaultDbPath, resolveProjectContext } from "./projectContext.js";
import { resolveStoredProject } from "./projectMigration.js";
import type {
  DoctorReport,
  EventExportRow,
  EventRecordInput,
  HandoffExportRow,
  MemoryExport,
  MemoryPaths,
  ProjectContext,
  PurgeMemoryInput,
  PurgeMemoryResult,
  RecentEvent,
  SessionBootstrapInput,
  SessionBootstrapResult,
  SessionExportRow,
  SessionStartInput,
} from "./types.js";

export class PurgeConfirmationError extends Error {
  constructor() {
    super("purge requires --yes");
    this.name = "PurgeConfirmationError";
  }
}

export function memoryPaths(): MemoryPaths {
  return { dbPath: defaultDbPath() };
}

export function doctorReport(dbPath = defaultDbPath()): DoctorReport {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const project = resolveStoredProject(db, resolveProjectContext());
    const schemaVersion = Number(db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").pluck().get());
    const count = (table: string): number => Number(db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get());
    return {
      paths: { dbPath },
      schemaVersion,
      project,
      counts: {
        projects: count("projects"),
        sessions: count("sessions"),
        events: count("events"),
        handoffs: count("handoffs"),
      },
    };
  } finally {
    db.close();
  }
}

export function upsertProject(db: Database.Database, project: ProjectContext): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO projects (id, repo_root, git_remote, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      repo_root = excluded.repo_root,
      git_remote = excluded.git_remote,
      last_seen_at = excluded.last_seen_at
  `).run(project.id, project.repoRoot, project.gitRemote, now, now);
}

export function startSession(input: SessionStartInput, dbPath = defaultDbPath()): { readonly sessionId: string; readonly project: ProjectContext } {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const project = resolveStoredProject(db, resolveProjectContext());
    upsertProject(db, project);
    const sessionId = randomUUID();
    db.prepare(`
      INSERT INTO sessions (id, project_id, host, adapter, started_at, git_branch, git_head)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, project.id, input.host, input.adapter, new Date().toISOString(), project.gitBranch, project.gitHead);
    return { sessionId, project };
  } finally {
    db.close();
  }
}

export function bootstrapSession(input: SessionBootstrapInput, dbPath = defaultDbPath()): SessionBootstrapResult {
  const session = startSession({ host: input.host, adapter: input.adapter }, dbPath);
  return { ...session, recentEvents: recentEvents(input.limit, dbPath) };
}

export function recordEvent(input: EventRecordInput, dbPath = defaultDbPath()): { readonly eventId: string; readonly project: ProjectContext } {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const project = resolveStoredProject(db, resolveProjectContext());
    upsertProject(db, project);
    const eventId = randomUUID();
    db.prepare(`
      INSERT INTO events (id, session_id, project_id, type, summary, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      input.sessionId ?? null,
      project.id,
      input.type,
      redactSecrets(input.summary),
      input.payloadJson === undefined ? null : redactSecrets(input.payloadJson),
      new Date().toISOString(),
    );
    return { eventId, project };
  } finally {
    db.close();
  }
}

export function recentEvents(limit: number, dbPath = defaultDbPath()): readonly RecentEvent[] {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const project = resolveStoredProject(db, resolveProjectContext());
    return db
      .prepare(`
      SELECT id, type, summary, created_at AS createdAt, session_id AS sessionId
      FROM events
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
      .all(project.id, limit) as RecentEvent[];
  } finally {
    db.close();
  }
}

export function writeHandoff(
  summaryMd: string,
  sessionId?: string,
  dbPath = defaultDbPath(),
): { readonly handoffId: string; readonly project: ProjectContext } {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const project = resolveStoredProject(db, resolveProjectContext());
    upsertProject(db, project);
    const handoffId = randomUUID();
    db.prepare(`
      INSERT INTO handoffs (id, project_id, session_id, summary_md, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(handoffId, project.id, sessionId ?? null, redactSecrets(summaryMd), new Date().toISOString());
    return { handoffId, project };
  } finally {
    db.close();
  }
}

export function exportMemory(dbPath = defaultDbPath()): MemoryExport {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const project = resolveStoredProject(db, resolveProjectContext());
    const sessions = db
      .prepare(`
      SELECT id, host, adapter, started_at AS startedAt, ended_at AS endedAt, git_branch AS gitBranch, git_head AS gitHead FROM sessions
      WHERE project_id = ? ORDER BY started_at ASC, id ASC
    `)
      .all(project.id) as SessionExportRow[];
    const events = db
      .prepare(`
      SELECT id, session_id AS sessionId, type, summary, payload_json AS payloadJson, created_at AS createdAt FROM events
      WHERE project_id = ? ORDER BY created_at ASC, id ASC
    `)
      .all(project.id) as EventExportRow[];
    const handoffs = db
      .prepare(`
      SELECT id, session_id AS sessionId, summary_md AS summaryMd, created_at AS createdAt FROM handoffs
      WHERE project_id = ? ORDER BY created_at ASC, id ASC
    `)
      .all(project.id) as HandoffExportRow[];
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      paths: { dbPath },
      project,
      sessions,
      events,
      handoffs,
    };
  } finally {
    db.close();
  }
}

export function purgeMemory(input: PurgeMemoryInput, dbPath = defaultDbPath()): PurgeMemoryResult {
  if (!input.yes) throw new PurgeConfirmationError();

  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const project = resolveStoredProject(db, resolveProjectContext());
    const deleteProject = db.transaction(() => {
      const events = db
        .prepare("DELETE FROM events WHERE project_id IN (SELECT id FROM projects WHERE id = ? OR repo_root = ?)")
        .run(project.id, project.repoRoot).changes;
      const handoffs = db
        .prepare("DELETE FROM handoffs WHERE project_id IN (SELECT id FROM projects WHERE id = ? OR repo_root = ?)")
        .run(project.id, project.repoRoot).changes;
      const sessions = db
        .prepare("DELETE FROM sessions WHERE project_id IN (SELECT id FROM projects WHERE id = ? OR repo_root = ?)")
        .run(project.id, project.repoRoot).changes;
      const projects = db.prepare("DELETE FROM projects WHERE id = ? OR repo_root = ?").run(project.id, project.repoRoot).changes;
      return { events, handoffs, sessions, projects };
    });
    return { project, deleted: deleteProject() };
  } finally {
    db.close();
  }
}
