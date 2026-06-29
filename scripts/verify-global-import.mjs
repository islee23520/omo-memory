#!/usr/bin/env node
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const distGlobalMemory = join(root, "dist", "globalMemory.js");
const evidencePath = join(root, ".omo", "evidence", "omo-memory-second-brain-retention", "task-5-global-index.txt");

function fail(message) {
  throw new Error(`VERIFY FAIL: ${message}`);
}

function createMemoryDb(dbPath, fixture) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE projects (id TEXT PRIMARY KEY, repo_root TEXT NOT NULL, git_remote TEXT, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, host TEXT NOT NULL, adapter TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, git_branch TEXT, git_head TEXT);
      CREATE TABLE events (id TEXT PRIMARY KEY, session_id TEXT, project_id TEXT NOT NULL, type TEXT NOT NULL, summary TEXT NOT NULL, payload_json TEXT, created_at TEXT NOT NULL);
      CREATE TABLE handoffs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT, summary_md TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('version', ?)").run(String(fixture.schemaVersion));
    db.prepare("INSERT INTO projects (id, repo_root, git_remote, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
      fixture.projectId,
      fixture.repoRoot,
      fixture.gitRemote,
      fixture.createdAt,
      fixture.createdAt,
    );
    db.prepare("INSERT INTO sessions (id, project_id, host, adapter, started_at, git_branch, git_head) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      fixture.sessionId,
      fixture.projectId,
      fixture.host,
      fixture.adapter,
      fixture.createdAt,
      fixture.gitBranch,
      fixture.gitHead,
    );
    const insertEvent = db.prepare("INSERT INTO events (id, session_id, project_id, type, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const event of fixture.events) {
      insertEvent.run(event.id, fixture.sessionId, fixture.projectId, event.type, event.summary, event.payloadJson, event.createdAt);
    }
    if (fixture.handoffId !== null) {
      db.prepare("INSERT INTO handoffs (id, project_id, session_id, summary_md, created_at) VALUES (?, ?, ?, ?, ?)").run(
        fixture.handoffId,
        fixture.projectId,
        fixture.sessionId,
        fixture.summaryMd,
        fixture.createdAt,
      );
    }
  } finally {
    db.close();
  }
}

function countRows(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const tables = ["projects", "sessions", "events", "handoffs"];
    return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  } finally {
    db.close();
  }
}

function globalCount(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

async function main() {
  const globalMemory = await import(distGlobalMemory);
  const { migrateToGlobalMemory, listGlobalMemory } = globalMemory;
  if (typeof migrateToGlobalMemory !== "function") fail("migrateToGlobalMemory export missing");
  if (typeof listGlobalMemory !== "function") fail("listGlobalMemory export missing");

  const tempRoot = mkdtempSync(join(tmpdir(), "omo-global-import-"));
  try {
    const projectADb = join(tempRoot, "project-a", ".omo", "memory", "state.sqlite");
    const projectBDb = join(tempRoot, "project-b", ".omo", "memory", "state.sqlite");
    const projectCDb = join(tempRoot, "project-c", ".omo", "memory", "state.sqlite");
    const globalDbPath = join(tempRoot, "global.sqlite");
    createMemoryDb(projectADb, {
      schemaVersion: 3,
      projectId: "project-a",
      repoRoot: "/tmp/project-a",
      gitRemote: "git@example.com:a.git",
      sessionId: "session-a",
      host: "codex",
      adapter: "local",
      gitBranch: "main",
      gitHead: "aaaa",
      createdAt: "2026-06-29T00:00:00.000Z",
      events: [
        { id: "event-a1", type: "decision", summary: "a1", payloadJson: null, createdAt: "2026-06-29T00:01:00.000Z" },
        { id: "event-a2", type: "evidence", summary: "a2", payloadJson: "{}", createdAt: "2026-06-29T00:02:00.000Z" },
      ],
      handoffId: null,
      summaryMd: "",
    });
    createMemoryDb(projectBDb, {
      schemaVersion: 1,
      projectId: "project-b",
      repoRoot: "/tmp/project-b",
      gitRemote: "",
      sessionId: "session-b",
      host: "unknown",
      adapter: "v1",
      gitBranch: null,
      gitHead: null,
      createdAt: "2026-06-29T01:00:00.000Z",
      events: [{ id: "event-b1", type: "handoff", summary: "b1", payloadJson: null, createdAt: "2026-06-29T01:01:00.000Z" }],
      handoffId: "handoff-b1",
      summaryMd: "handoff b1",
    });
    mkdirSync(dirname(projectCDb), { recursive: true });
    writeFileSync(projectCDb, "not sqlite");

    const sourceDbs = [projectADb, projectBDb];
    const beforeMtimes = new Map(sourceDbs.map((path) => [path, statSync(path).mtimeMs]));
    const beforeCounts = new Map(sourceDbs.map((path) => [path, countRows(path)]));
    const firstReport = migrateToGlobalMemory({ rootPath: tempRoot, globalDbPath });
    if (firstReport.skipped.length !== 1 || !firstReport.skipped[0].dbPath.endsWith("project-c/.omo/memory/state.sqlite")) {
      fail(`skipped result did not include project-c: ${JSON.stringify(firstReport.skipped)}`);
    }

    const listed = listGlobalMemory(globalDbPath);
    if (listed.sources.length !== 2) fail(`listed sources ${listed.sources.length} !== 2`);
    const global = new Database(globalDbPath, { readonly: true, fileMustExist: true });
    try {
      if (globalCount(global, "sources") !== 2) fail("global sources count !== 2");
      if (globalCount(global, "global_projects") !== 2) fail("global projects count !== 2");
      if (globalCount(global, "global_events") !== 3) fail("global events count !== 3");
      if (globalCount(global, "global_handoffs") !== 1) fail("global handoffs count !== 1");
      const badEvent = global
        .prepare("SELECT id FROM global_events WHERE source_id IS NULL OR source_event_id IS NULL OR source_project_id IS NULL OR source_session_id IS NULL")
        .get();
      if (badEvent !== undefined) fail(`event missing provenance: ${JSON.stringify(badEvent)}`);
    } finally {
      global.close();
    }

    const secondReport = migrateToGlobalMemory({ rootPath: tempRoot, globalDbPath });
    if (secondReport.after.events !== firstReport.after.events || secondReport.after.handoffs !== firstReport.after.handoffs) {
      fail(`rerun changed global counts: ${JSON.stringify(secondReport.after)} vs ${JSON.stringify(firstReport.after)}`);
    }
    for (const path of sourceDbs) {
      if (statSync(path).mtimeMs !== beforeMtimes.get(path)) fail(`source mtime changed for ${path}`);
      if (JSON.stringify(countRows(path)) !== JSON.stringify(beforeCounts.get(path))) fail(`source row counts changed for ${path}`);
    }

    appendFileSync(
      evidencePath,
      [
        "",
        "GREEN: node scripts/verify-global-import.mjs",
        `temp_root=${tempRoot}`,
        "sources=2",
        "projects=2",
        "events=3",
        "handoffs=1",
        "rerun_counts=unchanged",
        "source_mtimes=unchanged",
        "source_row_counts=unchanged",
      ].join("\n"),
    );
    console.log("VERIFY PASS: global memory import idempotent read-only migration");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
