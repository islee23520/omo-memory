#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function fail(message) {
  throw new Error(`VERIFY FAIL: ${message}`);
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get());
}

function createLegacyDb(dbPath, project) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  const now = "2026-06-30T00:00:00.000Z";
  try {
    db.exec(`
      CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE projects (id TEXT PRIMARY KEY, repo_root TEXT NOT NULL, git_remote TEXT, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, host TEXT NOT NULL, adapter TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, git_branch TEXT, git_head TEXT);
      CREATE TABLE events (id TEXT PRIMARY KEY, session_id TEXT, project_id TEXT NOT NULL, type TEXT NOT NULL, summary TEXT NOT NULL, payload_json TEXT, created_at TEXT NOT NULL);
      CREATE TABLE handoffs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT, summary_md TEXT NOT NULL, created_at TEXT NOT NULL);

      CREATE TABLE concepts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, description TEXT, aliases_json TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE relations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, relation TEXT NOT NULL, weight REAL NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE durable_memories (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, summary TEXT NOT NULL, body TEXT, source_event_id TEXT, confidence REAL NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE decision_records (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, rationale TEXT NOT NULL, status TEXT NOT NULL, source_event_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE memory_references (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('schema_version', '2')").run();
    db.prepare("INSERT INTO projects (id, repo_root, git_remote, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
      project.id,
      project.repoRoot,
      project.gitRemote,
      now,
      now,
    );
    db.prepare("INSERT INTO sessions (id, project_id, host, adapter, started_at, git_branch, git_head) VALUES (?, ?, 'codex', 'legacy-compat', ?, ?, ?)").run(
      "legacy-session",
      project.id,
      now,
      project.gitBranch,
      project.gitHead,
    );
    db.prepare(
      "INSERT INTO events (id, session_id, project_id, type, summary, payload_json, created_at) VALUES ('legacy-event', 'legacy-session', ?, 'decision', 'legacy ledger event survives ontology compatibility', '{}', ?)",
    ).run(project.id, now);
    db.prepare(
      "INSERT INTO handoffs (id, project_id, session_id, summary_md, created_at) VALUES ('legacy-handoff', ?, 'legacy-session', 'legacy handoff', ?)",
    ).run(project.id, now);
    db.prepare(
      "INSERT INTO concepts (id, project_id, kind, label, description, aliases_json, payload_json, created_at, updated_at) VALUES ('legacy-concept', ?, 'term', 'legacy concept', 'legacy compatibility row', '[]', '{}', ?, ?)",
    ).run(project.id, now, now);
    db.prepare(
      "INSERT INTO relations (id, project_id, source_type, source_id, target_type, target_id, relation, weight, payload_json, created_at, updated_at) VALUES ('legacy-relation', ?, 'event', 'legacy-event', 'concept', 'legacy-concept', 'mentions', 1, '{}', ?, ?)",
    ).run(project.id, now, now);
    db.prepare(
      "INSERT INTO durable_memories (id, project_id, type, summary, body, source_event_id, confidence, status, created_at, updated_at) VALUES ('legacy-memory', ?, 'preference', 'legacy durable row', 'legacy body', 'legacy-event', 0.9, 'active', ?, ?)",
    ).run(project.id, now, now);
    db.prepare(
      "INSERT INTO decision_records (id, project_id, title, rationale, status, source_event_id, created_at, updated_at) VALUES ('legacy-decision', ?, 'legacy decision', 'legacy rationale', 'active', 'legacy-event', ?, ?)",
    ).run(project.id, now, now);
    db.prepare(
      "INSERT INTO memory_references (id, project_id, source_type, source_id, target_type, target_id, created_at) VALUES ('legacy-reference', ?, 'event', 'legacy-event', 'concept', 'legacy-concept', ?)",
    ).run(project.id, now);
  } finally {
    db.close();
  }
}

async function main() {
  const [{ resolveProjectContext }, { doctorReport }, { exportMemory, purgeMemory, recentEvents }] = await Promise.all([
    import(join(root, "dist", "projectContext.js")),
    import(join(root, "dist", "memoryReport.js")),
    import(join(root, "dist", "memory.js")),
  ]);

  const tempRoot = mkdtempSync(join(tmpdir(), "omo-legacy-ontology-"));
  const dbPath = join(tempRoot, "state.sqlite");
  try {
    const project = resolveProjectContext(root);
    createLegacyDb(dbPath, project);

    const doctor = doctorReport(dbPath);
    if (doctor.counts.concepts !== 1 || doctor.counts.relations !== 1 || doctor.counts.durableMemories !== 1 || doctor.counts.decisionRecords !== 1) {
      fail(`doctor legacy counts mismatch: ${JSON.stringify(doctor.counts)}`);
    }

    const exported = exportMemory(dbPath);
    if (
      exported.concepts.length !== 1 ||
      exported.relations.length !== 1 ||
      exported.durableMemories.length !== 1 ||
      exported.decisionRecords.length !== 1 ||
      exported.memoryReferences.length !== 1
    ) {
      fail(
        `export legacy rows mismatch: ${JSON.stringify({ concepts: exported.concepts.length, relations: exported.relations.length, durableMemories: exported.durableMemories.length, decisionRecords: exported.decisionRecords.length, memoryReferences: exported.memoryReferences.length })}`,
      );
    }

    const recent = recentEvents(5, dbPath);
    if (!recent.some((event) => event.id === "legacy-event")) fail("recent did not read core legacy event");

    const purged = purgeMemory({ yes: true }, dbPath);
    if (
      purged.deleted.concepts !== 1 ||
      purged.deleted.relations !== 1 ||
      purged.deleted.durableMemories !== 1 ||
      purged.deleted.decisionRecords !== 1 ||
      purged.deleted.memoryReferences !== 1
    ) {
      fail(`purge did not delete legacy ontology rows: ${JSON.stringify(purged.deleted)}`);
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      for (const table of [
        "projects",
        "sessions",
        "events",
        "handoffs",
        "concepts",
        "relations",
        "durable_memories",
        "decision_records",
        "memory_references",
      ]) {
        if (count(db, table) !== 0) fail(`${table} retained rows after purge`);
      }
    } finally {
      db.close();
    }

    console.log("VERIFY PASS: legacy ontology tables remain guarded for doctor/export/recent/purge");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
