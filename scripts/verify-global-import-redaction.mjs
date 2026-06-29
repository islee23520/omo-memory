#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const distGlobalMemory = join(root, "dist", "globalMemory.js");

const rawSecrets = ["github_pat_RAWSECRET1234567890", "sk-reviewsecret123456", "Bearer rawsecret123456", "secret123456"];

function fail(message) {
  throw new Error(`VERIFY FAIL: ${message}`);
}

function createRawSourceDb(dbPath) {
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
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('version', '1')").run();
    db.prepare("INSERT INTO projects (id, repo_root, git_remote, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
      "legacy-project",
      "/tmp/raw-legacy-project",
      "https://github_pat_RAWSECRET1234567890@github.com/org/repo.git",
      "2026-06-29T00:00:00.000Z",
      "2026-06-29T00:00:00.000Z",
    );
    db.prepare("INSERT INTO sessions (id, project_id, host, adapter, started_at, git_branch, git_head) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "legacy-session",
      "legacy-project",
      "unknown",
      "legacy",
      "2026-06-29T00:01:00.000Z",
      "main",
      "abc123",
    );
    db.prepare("INSERT INTO events (id, session_id, project_id, type, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "legacy-event",
      "legacy-session",
      "legacy-project",
      "decision",
      "raw summary token=sk-reviewsecret123456",
      '{"api_key":"secret123456"}',
      "2026-06-29T00:02:00.000Z",
    );
    db.prepare("INSERT INTO handoffs (id, project_id, session_id, summary_md, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "legacy-handoff",
      "legacy-project",
      "legacy-session",
      "handoff Bearer rawsecret123456",
      "2026-06-29T00:03:00.000Z",
    );
  } finally {
    db.close();
  }
}

function readTextColumns(db, tableName) {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .filter((column) => column.type === "TEXT");
  return columns.flatMap((column) =>
    db
      .prepare(`SELECT ${column.name} AS value FROM ${tableName}`)
      .all()
      .map((row) => String(row.value ?? "")),
  );
}

async function main() {
  const { migrateToGlobalMemory } = await import(distGlobalMemory);
  if (typeof migrateToGlobalMemory !== "function") fail("migrateToGlobalMemory export missing");

  const tempRoot = mkdtempSync(join(tmpdir(), "omo-global-redaction-"));
  try {
    const sourceDbPath = join(tempRoot, "legacy", ".omo", "memory", "state.sqlite");
    const globalDbPath = join(tempRoot, "global.sqlite");
    createRawSourceDb(sourceDbPath);
    migrateToGlobalMemory({ rootPath: tempRoot, globalDbPath });

    const db = new Database(globalDbPath, { readonly: true, fileMustExist: true });
    try {
      const text = ["global_projects", "global_events", "global_handoffs", "events", "handoffs"]
        .flatMap((tableName) => readTextColumns(db, tableName))
        .join("\n");
      for (const secret of rawSecrets) {
        if (text.includes(secret)) fail(`raw secret survived global import: ${secret}`);
      }
      if (!text.includes("[REDACTED]")) fail("redacted marker missing from imported global memory");
    } finally {
      db.close();
    }

    console.log("VERIFY PASS: global import redacts raw legacy source values");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
