#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const evidencePath = join(root, ".omo", "evidence", "omo-memory-core-ledger", "global-import-fixtures.txt");

const realDbPaths = [
  "/Users/ilseoblee/workspace/game-engine/Linaforge/.omo/memory/state.sqlite",
  "/Users/ilseoblee/workspace/ULW/omo-memory/.omo/memory/state.sqlite",
  "/Users/ilseoblee/workspace/linalab/lfg/.omo/memory/state.sqlite",
  "/Users/ilseoblee/workspace/ULW/omo-phone/.omo/memory/state.sqlite",
];

const fixtures = [
  {
    pathParts: ["game-engine", "Linaforge"],
    schemaVersion: 3,
    projectId: "linaforge-project",
    repoRoot: "/fixtures/game-engine/Linaforge",
    remote: "https://example.invalid/Linaforge.git",
    host: "codex",
    adapter: "lazycodex",
    events: [
      ["linaforge-event-1", "decision", "Linaforge game engine records renderer decisions in the local ledger"],
      ["linaforge-event-2", "qa_evidence", "Linaforge verifier preserves source provenance during global import"],
    ],
  },
  {
    pathParts: ["ULW", "omo-memory"],
    schemaVersion: 3,
    projectId: "omo-memory-project",
    repoRoot: "/fixtures/ULW/omo-memory",
    remote: "https://example.invalid/omo-memory.git",
    host: "codex",
    adapter: "lazycodex",
    events: [
      ["omo-memory-event-1", "decision", "OMO Memory global sqlite migration keeps event source provenance"],
      ["omo-memory-event-2", "qa_evidence", "omo-memory recall remains explicit after global import"],
    ],
  },
  {
    pathParts: ["linalab", "lfg"],
    schemaVersion: 2,
    projectId: "lfg-project",
    repoRoot: "/fixtures/linalab/lfg",
    remote: "https://example.invalid/lfg.git",
    host: "grok",
    adapter: "lfg",
    events: [
      ["lfg-event-1", "decision", "lfg adapter records user action summaries for explicit recall"],
      ["lfg-event-2", "qa_evidence", "lfg import shares global sqlite source references"],
    ],
  },
  {
    pathParts: ["ULW", "omo-phone"],
    schemaVersion: 1,
    projectId: "omo-phone-project",
    repoRoot: "/fixtures/ULW/omo-phone",
    remote: "",
    host: "unknown",
    adapter: "legacy-v1",
    events: [["omo-phone-event-1", "decision", "omo-phone legacy v1 sqlite import remains read only"]],
  },
];

function fail(message) {
  throw new Error(`VERIFY FAIL: ${message}`);
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).pluck().get());
}

function captureMtimes(paths) {
  return new Map(paths.filter((path) => statMaybe(path) !== null).map((path) => [path, statSync(path).mtimeMs]));
}

function statMaybe(path) {
  try {
    return statSync(path);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function assertMtimesUnchanged(label, before) {
  for (const [path, mtime] of before) {
    if (statSync(path).mtimeMs !== mtime) fail(`${label} mtime changed for ${path}`);
  }
}

function fixtureDbPath(tempRoot, fixture) {
  return join(tempRoot, ...fixture.pathParts, ".omo", "memory", "state.sqlite");
}

function createFixtureDb(dbPath, fixture) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  const now = "2026-06-29T00:00:00.000Z";
  const sessionId = `${fixture.projectId}-session`;
  try {
    db.exec(`
      CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE projects (id TEXT PRIMARY KEY, repo_root TEXT NOT NULL, git_remote TEXT, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, host TEXT NOT NULL, adapter TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, git_branch TEXT, git_head TEXT);
      CREATE TABLE events (id TEXT PRIMARY KEY, session_id TEXT, project_id TEXT NOT NULL, type TEXT NOT NULL, summary TEXT NOT NULL, payload_json TEXT, created_at TEXT NOT NULL);
      CREATE TABLE handoffs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT, summary_md TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    db.prepare("INSERT INTO schema_meta (key, value) VALUES (?, ?)").run(
      fixture.schemaVersion === 3 ? "schema_version" : "version",
      String(fixture.schemaVersion),
    );
    db.prepare("INSERT INTO projects (id, repo_root, git_remote, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
      fixture.projectId,
      fixture.repoRoot,
      fixture.remote,
      now,
      now,
    );
    db.prepare("INSERT INTO sessions (id, project_id, host, adapter, started_at, git_branch, git_head) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      sessionId,
      fixture.projectId,
      fixture.host,
      fixture.adapter,
      now,
      "main",
      "fixture-head",
    );
    const insertEvent = db.prepare("INSERT INTO events (id, session_id, project_id, type, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const [id, type, summary] of fixture.events) {
      insertEvent.run(id, sessionId, fixture.projectId, type, summary, JSON.stringify({ fixture: fixture.projectId }), now);
    }
    db.prepare("INSERT INTO handoffs (id, project_id, session_id, summary_md, created_at) VALUES (?, ?, ?, ?, ?)").run(
      `${fixture.projectId}-handoff`,
      fixture.projectId,
      sessionId,
      `${fixture.projectId} sanitized handoff`,
      now,
    );
  } finally {
    db.close();
  }
}

async function main() {
  const [{ scanForMemoryDbs, migrateToGlobalMemory, listGlobalMemory }, { resolveProjectContext }] = await Promise.all([
    import(join(root, "dist", "globalMemory.js")),
    import(join(root, "dist", "projectContext.js")),
  ]);

  const tempRoot = mkdtempSync(join(tmpdir(), "omo-global-import-fixtures-"));
  try {
    for (const fixture of fixtures) createFixtureDb(fixtureDbPath(tempRoot, fixture), fixture);
    const sourceDbs = fixtures.map((fixture) => fixtureDbPath(tempRoot, fixture));
    const sourceMtimes = captureMtimes(sourceDbs);
    const realMtimes = captureMtimes(realDbPaths);

    const realScans = realDbPaths.filter((path) => statMaybe(path) !== null).map((path) => scanForMemoryDbs(dirname(dirname(dirname(path)))));
    assertMtimesUnchanged("real scan", realMtimes);
    const requiredRealHits = realDbPaths.filter((path) => statMaybe(path) !== null).length;
    const realCandidates = realScans.flatMap((scan) => scan.candidates);
    const realHitCount = realDbPaths.filter((path) => realCandidates.some((candidate) => candidate.dbPath === path)).length;
    if (realHitCount !== requiredRealHits) fail(`real scan hit ${realHitCount}/${requiredRealHits} expected DBs`);

    const globalDbPath = join(tempRoot, "global", "memory.sqlite");
    const firstReport = migrateToGlobalMemory({ rootPath: tempRoot, globalDbPath });
    assertMtimesUnchanged("fixture migrate", sourceMtimes);
    if (firstReport.sources !== 4) fail(`sources ${firstReport.sources} !== 4`);
    if (firstReport.after.projects !== 4 || firstReport.after.events !== 7) fail(`unexpected global counts ${JSON.stringify(firstReport.after)}`);

    const aggregateProject = resolveProjectContext(root);
    const db = new Database(globalDbPath, { readonly: true, fileMustExist: true });
    let aggregateEvents;
    try {
      if (count(db, "global_projects") !== 4) fail("global_projects count !== 4");
      if (count(db, "events") !== 7) fail("canonical aggregate events count !== 7");
      aggregateEvents = db.prepare("SELECT id, type, summary FROM events WHERE project_id = ? ORDER BY id ASC").all(aggregateProject.id);
    } finally {
      db.close();
    }
    if (aggregateEvents.length !== 7) fail(`aggregate events ${aggregateEvents.length} !== 7`);
    if (!aggregateEvents.some((event) => event.summary.includes("explicit recall"))) fail("expected imported event summary missing");

    const secondReport = migrateToGlobalMemory({ rootPath: tempRoot, globalDbPath });
    assertMtimesUnchanged("fixture rerun", sourceMtimes);
    if (secondReport.after.events !== firstReport.after.events) fail("rerun duplicated global events");

    const listed = listGlobalMemory(globalDbPath);
    if (listed.counts.sources !== 4 || listed.counts.events !== 7) fail(`global list mismatch: ${JSON.stringify(listed.counts)}`);
    const report = {
      globalDbPath,
      realDbHits: realHitCount,
      sourceProjectCount: firstReport.sources,
      importedProjectCount: firstReport.after.projects,
      eventCount: firstReport.after.events,
      duplicateCount: firstReport.after.events,
      skippedCount: firstReport.skipped.length,
      schemaVersions: listed.sources.map((source) => source.schemaVersion).sort((left, right) => left - right),
      sourceMtimes: "unchanged",
      realMtimes: "unchanged",
    };
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
    console.log("VERIFY PASS: cross-project event ledgers imported into global SQLite with provenance");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
