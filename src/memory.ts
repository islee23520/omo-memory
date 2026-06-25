import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

export type HostName = "codex" | "opencode" | "grok" | "unknown";

export type ProjectContext = {
  readonly id: string;
  readonly repoRoot: string;
  readonly gitRemote: string | null;
  readonly gitBranch: string | null;
  readonly gitHead: string | null;
};

export type SessionStartInput = {
  readonly host: HostName;
  readonly adapter: string;
};

export type EventRecordInput = {
  readonly type: string;
  readonly summary: string;
  readonly payloadJson?: string;
  readonly sessionId?: string;
};

export type MemoryPaths = {
  readonly dbPath: string;
};

const SCHEMA_VERSION = 1;

export function defaultDbPath(): string {
  return process.env["OMO_MEMORY_DB"] ?? join(homedir(), ".omo", "memory", "state.sqlite");
}

export function memoryPaths(): MemoryPaths {
  return { dbPath: defaultDbPath() };
}

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
  db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
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

export function resolveProjectContext(cwd = process.cwd()): ProjectContext {
  const repoRoot = gitValue(["rev-parse", "--show-toplevel"], cwd) ?? resolve(cwd);
  const gitRemote = gitValue(["config", "--get", "remote.origin.url"], repoRoot);
  const gitBranch = gitValue(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
  const gitHead = gitValue(["rev-parse", "HEAD"], repoRoot);
  const id = createHash("sha256").update(`${gitRemote ?? ""}\n${repoRoot}`).digest("hex").slice(0, 24);
  return { id, repoRoot, gitRemote, gitBranch, gitHead };
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
    const project = resolveProjectContext();
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

export function recordEvent(input: EventRecordInput, dbPath = defaultDbPath()): { readonly eventId: string; readonly project: ProjectContext } {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const project = resolveProjectContext();
    upsertProject(db, project);
    const eventId = randomUUID();
    db.prepare(`
      INSERT INTO events (id, session_id, project_id, type, summary, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(eventId, input.sessionId ?? null, project.id, input.type, input.summary, input.payloadJson ?? null, new Date().toISOString());
    return { eventId, project };
  } finally {
    db.close();
  }
}

export type RecentEvent = {
  readonly id: string;
  readonly type: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly sessionId: string | null;
};

export function recentEvents(limit: number, dbPath = defaultDbPath()): readonly RecentEvent[] {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const project = resolveProjectContext();
    upsertProject(db, project);
    return db.prepare(`
      SELECT id, type, summary, created_at AS createdAt, session_id AS sessionId
      FROM events
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(project.id, limit) as RecentEvent[];
  } finally {
    db.close();
  }
}

export function writeHandoff(summaryMd: string, sessionId?: string, dbPath = defaultDbPath()): { readonly handoffId: string; readonly project: ProjectContext } {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const project = resolveProjectContext();
    upsertProject(db, project);
    const handoffId = randomUUID();
    db.prepare(`
      INSERT INTO handoffs (id, project_id, session_id, summary_md, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(handoffId, project.id, sessionId ?? null, summaryMd, new Date().toISOString());
    return { handoffId, project };
  } finally {
    db.close();
  }
}

function gitValue(args: readonly string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}
