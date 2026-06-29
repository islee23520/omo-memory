#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const distGlobalMemory = join(root, "dist", "globalMemory.js");
const distMemoryDb = join(root, "dist", "memoryDb.js");
const evidencePath = join(root, ".omo", "evidence", "omo-memory-second-brain-retention", "task-5-global-index.txt");

function fail(message) {
  throw new Error(`VERIFY FAIL: ${message}`);
}

function createValidMemoryDb(dbPath, schemaVersion) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE projects (id TEXT PRIMARY KEY, repo_root TEXT NOT NULL, git_remote TEXT, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
      CREATE TABLE events (id TEXT PRIMARY KEY, session_id TEXT, project_id TEXT NOT NULL, type TEXT NOT NULL, summary TEXT NOT NULL, payload_json TEXT, created_at TEXT NOT NULL);
    `);
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('version', ?)").run(String(schemaVersion));
    db.prepare("INSERT INTO projects (id, repo_root, git_remote, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
      `project-${schemaVersion}`,
      `/tmp/project-${schemaVersion}`,
      "",
      "2026-06-29T00:00:00.000Z",
      "2026-06-29T00:00:00.000Z",
    );
    db.prepare("INSERT INTO events (id, project_id, type, summary, created_at) VALUES (?, ?, ?, ?, ?)").run(
      `event-${schemaVersion}`,
      `project-${schemaVersion}`,
      "decision",
      `fixture ${schemaVersion}`,
      "2026-06-29T00:00:00.000Z",
    );
  } finally {
    db.close();
  }
}

function mtimeMs(path) {
  return statSync(path).mtimeMs;
}

async function main() {
  if (!existsSync(distGlobalMemory)) {
    console.error("RED: dist/globalMemory.js missing/import failed");
  }

  const globalMemory = await import(distGlobalMemory);
  const memoryDb = await import(distMemoryDb);
  const { initGlobalMemory, scanForMemoryDbs } = globalMemory;
  const { initMemory } = memoryDb;
  if (typeof initGlobalMemory !== "function") fail("initGlobalMemory export missing");
  if (typeof scanForMemoryDbs !== "function") fail("scanForMemoryDbs export missing");
  if (typeof initMemory !== "function") fail("initMemory export missing");

  const tempRoot = mkdtempSync(join(tmpdir(), "omo-global-scan-"));
  try {
    const firstDb = join(tempRoot, "one", ".omo", "memory", "state.sqlite");
    const secondDb = join(tempRoot, "nested", "two", ".omo", "memory", "state.sqlite");
    const currentDb = join(tempRoot, "current", ".omo", "memory", "state.sqlite");
    const skippedDb = join(tempRoot, "bad", ".omo", "memory", "state.sqlite");
    const globalDb = join(tempRoot, "global.sqlite");
    createValidMemoryDb(firstDb, 3);
    createValidMemoryDb(secondDb, 1);
    initMemory(currentDb);
    mkdirSync(dirname(skippedDb), { recursive: true });
    writeFileSync(skippedDb, "not sqlite");

    const before = new Map([
      [firstDb, mtimeMs(firstDb)],
      [secondDb, mtimeMs(secondDb)],
      [currentDb, mtimeMs(currentDb)],
      [skippedDb, mtimeMs(skippedDb)],
    ]);

    const initResult = initGlobalMemory(globalDb);
    if (initResult.dbPath !== globalDb) fail("initGlobalMemory returned wrong dbPath");
    const global = new Database(globalDb, { readonly: true, fileMustExist: true });
    try {
      const tableRows = global
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'global_%' OR name = 'sources') ORDER BY name")
        .all();
      const tableNames = tableRows.map((row) => row.name);
      const expectedTables = ["global_events", "global_handoffs", "global_projects", "global_sessions", "sources"];
      if (JSON.stringify(tableNames) !== JSON.stringify(expectedTables)) {
        fail(`global tables ${JSON.stringify(tableNames)} did not match ${JSON.stringify(expectedTables)}`);
      }
    } finally {
      global.close();
    }

    const scanResult = scanForMemoryDbs(tempRoot);
    if (scanResult.candidates.length !== 3) fail(`candidate count ${scanResult.candidates.length} !== 3`);
    if (scanResult.skipped.length !== 1) fail(`skipped count ${scanResult.skipped.length} !== 1`);
    const versions = scanResult.candidates.map((candidate) => candidate.schemaVersion).sort((left, right) => left - right);
    if (JSON.stringify(versions) !== JSON.stringify([1, 3, 3])) fail(`versions ${JSON.stringify(versions)} did not include 1, 3, and current 3`);
    const currentCandidate = scanResult.candidates.find((candidate) => candidate.dbPath === currentDb);
    if (currentCandidate?.schemaVersion !== 3) fail(`current schema_version DB scanned as ${currentCandidate?.schemaVersion ?? "missing"} instead of 3`);
    for (const [path, previousMtime] of before) {
      if (mtimeMs(path) !== previousMtime) fail(`mtime changed for ${path}`);
    }

    mkdirSync(dirname(evidencePath), { recursive: true });
    appendFileSync(
      evidencePath,
      [
        "",
        "GREEN: node scripts/verify-global-scan.mjs",
        `temp_root=${tempRoot}`,
        `candidates=${scanResult.candidates.length}`,
        `skipped=${scanResult.skipped.length}`,
        `versions=${versions.join(",")}`,
        `current_schema_version=${currentCandidate.schemaVersion}`,
        "source_mtimes=unchanged",
      ].join("\n"),
    );
    console.log("VERIFY PASS: global memory scan foundation");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
