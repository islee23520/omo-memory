#!/usr/bin/env node
/**
 * Focused verification for Todo 6 concept retention recomputation.
 * Runs against real dist/ exports + a temp SQLite DB.
 * RED first: fails when dist/retentionRecompute.js or recomputeRetentionScores is missing.
 */
import { appendFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const distRecompute = join(root, "dist", "retentionRecompute.js");
const evidencePath = join(root, ".omo", "evidence", "omo-memory-second-brain-retention", "task-6-retention-score.txt");
const nowIso = "2026-06-29T00:00:00.000Z";

function fail(message) {
  console.error("VERIFY FAIL:", message);
  process.exit(1);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

function assertAtLeast(actual, minimum, message) {
  if (actual < minimum) {
    fail(`${message}: got ${actual}, want >= ${minimum}`);
  }
}

function insertProject(db, id) {
  db.prepare(`
    INSERT INTO projects (id, repo_root, git_remote, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, `/tmp/${id}`, `https://example.com/${id}.git`, nowIso, nowIso);
}

function insertEvent(db, event) {
  db.prepare(`
    INSERT INTO events (id, session_id, project_id, type, summary, payload_json, created_at)
    VALUES (?, NULL, ?, ?, ?, NULL, ?)
  `).run(event.id, event.projectId, event.type, event.summary, event.createdAt);
}

function insertConcept(db, concept) {
  db.prepare(`
    INSERT INTO concepts (
      id, project_id, kind, label, description, aliases_json, payload_json,
      created_at, updated_at, score, retention_class, manual_pin, ref_count, project_spread, first_seen, last_seen
    ) VALUES (?, ?, 'term', ?, NULL, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    concept.id,
    concept.projectId,
    concept.label,
    concept.payloadJson,
    concept.createdAt,
    concept.updatedAt,
    concept.score,
    concept.retentionClass,
    concept.manualPin,
    concept.refCount,
    concept.projectSpread,
    concept.firstSeen,
    concept.lastSeen,
  );
}

function insertReference(db, reference) {
  db.prepare(`
    INSERT INTO memory_references (
      id, project_id, source_type, source_id, target_type, target_id, ref_kind, weight, created_at
    ) VALUES (?, ?, 'event', ?, 'concept', ?, 'mentions', ?, ?)
  `).run(reference.id, reference.projectId, reference.sourceId, reference.targetId, reference.weight, reference.createdAt);
}

function readConceptSnapshot(db) {
  return db
    .prepare(`
    SELECT id, score, retention_class AS retentionClass, manual_pin AS manualPin,
      ref_count AS refCount, project_spread AS projectSpread, updated_at AS updatedAt
    FROM concepts
    ORDER BY id ASC
  `)
    .all();
}

if (!existsSync(distRecompute)) {
  console.error("RED BASELINE: dist/retentionRecompute.js missing (Todo 6 recompute module not built)");
  appendFileSync(evidencePath, `\n[RED ${new Date().toISOString()}] dist/retentionRecompute.js missing before implementation\n`);
  process.exit(2);
}

const recomputeMod = await import(distRecompute);
const policyMod = await import(join(root, "dist", "retentionPolicy.js"));
const { recomputeRetentionScores } = recomputeMod;
const { classifyRetention } = policyMod;

if (typeof recomputeRetentionScores !== "function") {
  console.error("RED BASELINE: recomputeRetentionScores export missing");
  appendFileSync(evidencePath, `\n[RED ${new Date().toISOString()}] recomputeRetentionScores export missing\n`);
  process.exit(2);
}
if (typeof classifyRetention !== "function") fail("classifyRetention missing");

const tempRoot = mkdtempSync(join(tmpdir(), "omo-t6-recompute-"));
const dbPath = join(tempRoot, "state.sqlite");
const db = new Database(dbPath);

try {
  const memoryDbMod = await import(join(root, "dist", "memoryDb.js"));
  memoryDbMod.migrate(db);

  insertProject(db, "project-a");
  insertProject(db, "project-b");

  insertEvent(db, { id: "event-a1", projectId: "project-a", type: "decision", summary: "Adopt SQLite memory ledger", createdAt: "2026-06-28T00:00:00.000Z" });
  insertEvent(db, { id: "event-a2", projectId: "project-a", type: "qa", summary: "Verified SQLite memory ledger", createdAt: "2026-06-28T01:00:00.000Z" });
  insertEvent(db, { id: "event-b1", projectId: "project-b", type: "decision", summary: "Reuse SQLite memory ledger", createdAt: "2026-06-28T02:00:00.000Z" });
  insertEvent(db, { id: "event-old", projectId: "project-a", type: "note", summary: "Old one off idea", createdAt: "2025-01-01T00:00:00.000Z" });
  insertEvent(db, { id: "event-pin", projectId: "project-a", type: "note", summary: "Pinned rare fact", createdAt: "2025-01-01T00:00:00.000Z" });

  insertConcept(db, {
    id: "concept-a",
    projectId: "project-a",
    label: "sqlite memory ledger",
    payloadJson: '{"confidence":0.85}',
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    score: 10,
    retentionClass: "working",
    manualPin: 0,
    refCount: 1,
    projectSpread: 1,
    firstSeen: "2026-06-01T00:00:00.000Z",
    lastSeen: "2026-06-01T00:00:00.000Z",
  });
  insertConcept(db, {
    id: "concept-b",
    projectId: "project-b",
    label: "sqlite memory ledger",
    payloadJson: '{"confidence":0.85}',
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    score: 10,
    retentionClass: "working",
    manualPin: 0,
    refCount: 1,
    projectSpread: 1,
    firstSeen: "2026-06-02T00:00:00.000Z",
    lastSeen: "2026-06-02T00:00:00.000Z",
  });
  insertConcept(db, {
    id: "concept-old",
    projectId: "project-a",
    label: "one off stale note",
    payloadJson: '{"confidence":0.1}',
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    score: 60,
    retentionClass: "working",
    manualPin: 0,
    refCount: 1,
    projectSpread: 1,
    firstSeen: "2025-01-01T00:00:00.000Z",
    lastSeen: "2025-01-01T00:00:00.000Z",
  });
  insertConcept(db, {
    id: "concept-pin",
    projectId: "project-a",
    label: "pinned stale note",
    payloadJson: '{"confidence":0.1}',
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    score: 5,
    retentionClass: "permanent",
    manualPin: 1,
    refCount: 1,
    projectSpread: 1,
    firstSeen: "2025-01-01T00:00:00.000Z",
    lastSeen: "2025-01-01T00:00:00.000Z",
  });

  insertReference(db, { id: "ref-a1", projectId: "project-a", sourceId: "event-a1", targetId: "concept-a", weight: 1, createdAt: "2026-06-28T00:00:00.000Z" });
  insertReference(db, { id: "ref-a2", projectId: "project-a", sourceId: "event-a2", targetId: "concept-a", weight: 1, createdAt: "2026-06-28T01:00:00.000Z" });
  insertReference(db, { id: "ref-b1", projectId: "project-b", sourceId: "event-b1", targetId: "concept-b", weight: 1, createdAt: "2026-06-28T02:00:00.000Z" });
  insertReference(db, {
    id: "ref-old",
    projectId: "project-a",
    sourceId: "event-old",
    targetId: "concept-old",
    weight: 1,
    createdAt: "2025-01-01T00:00:00.000Z",
  });
  insertReference(db, {
    id: "ref-pin",
    projectId: "project-a",
    sourceId: "event-pin",
    targetId: "concept-pin",
    weight: 1,
    createdAt: "2025-01-01T00:00:00.000Z",
  });

  const first = recomputeRetentionScores({ dbPath, nowIso });
  const rows = readConceptSnapshot(db);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const conceptA = byId.get("concept-a");
  const conceptB = byId.get("concept-b");
  const conceptOld = byId.get("concept-old");
  const conceptPin = byId.get("concept-pin");
  if (!conceptA || !conceptB || !conceptOld || !conceptPin) fail("missing concept row after recompute");

  assertAtLeast(conceptA.score, 75, "cross-project concept A score");
  assertAtLeast(conceptB.score, 75, "cross-project concept B score");
  assertEqual(conceptA.retentionClass, "durable", "cross-project concept A retention");
  assertEqual(conceptB.retentionClass, "durable", "cross-project concept B retention");
  assertEqual(conceptOld.retentionClass, "forget", "old one-off concept retention");
  assertEqual(conceptPin.retentionClass, "permanent", "manual pin permanent guard");
  assertEqual(conceptPin.manualPin, 1, "manual pin preserved");

  for (const score of [29, 30, 49, 50, 74, 75, 89, 90]) {
    console.log(`BOUNDARY score=${score} -> ${classifyRetention(score, false)}`);
  }

  const beforeSecond = JSON.stringify(readConceptSnapshot(db));
  const second = recomputeRetentionScores({ dbPath, nowIso });
  const afterSecond = JSON.stringify(readConceptSnapshot(db));
  assertEqual(afterSecond, beforeSecond, "idempotent second recompute snapshot");
  assertEqual(second.updatedConcepts, 0, "idempotent second recompute update count");

  appendFileSync(
    evidencePath,
    [
      `\n[GREEN ${new Date().toISOString()}] retention recompute verifier PASS`,
      `first=${JSON.stringify(first)}`,
      `second=${JSON.stringify(second)}`,
      `rows=${JSON.stringify(rows)}`,
      `cleanup=${tempRoot}`,
    ].join("\n"),
  );

  console.log("VERIFY PASS: retention recompute deterministic, idempotent, decay/pin guards satisfied");
  console.log("FIRST:", JSON.stringify(first));
  console.log("SECOND:", JSON.stringify(second));
  console.log("ROWS:", JSON.stringify(rows));
} finally {
  db.close();
  rmSync(tempRoot, { recursive: true, force: true });
  console.log("CLEANUP: removed", tempRoot);
}
