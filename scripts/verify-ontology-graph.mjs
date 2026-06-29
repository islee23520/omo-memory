#!/usr/bin/env node
/**
 * Focused verification for Todo 9 ontology graph projection.
 * Runs against real dist/ exports + temp SQLite DBs.
 * RED first: fails when dist/ontologyGraph.js or projectOntologyGraph is missing.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const distGraph = join(root, "dist", "ontologyGraph.js");
const evidencePath = join(root, ".omo", "evidence", "omo-memory-second-brain-retention", "task-9-graph-projection.txt");
const nowIso = "2026-06-29T00:00:00.000Z";

mkdirSync(dirname(evidencePath), { recursive: true });

function writeEvidence(line) {
  appendFileSync(evidencePath, `${line}\n`);
}

function fail(message) {
  console.error("VERIFY FAIL:", message);
  process.exit(1);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${message}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

if (!existsSync(distGraph)) {
  console.error("RED BASELINE: dist/ontologyGraph.js missing (Todo 9 graph projection module not built)");
  writeEvidence(`[RED ${new Date().toISOString()}] dist/ontologyGraph.js missing before implementation`);
  process.exit(2);
}

const graphMod = await import(distGraph);
const memoryDbMod = await import(join(root, "dist", "memoryDb.js"));
const { projectOntologyGraph } = graphMod;

if (typeof projectOntologyGraph !== "function") {
  console.error("RED BASELINE: projectOntologyGraph export missing");
  writeEvidence(`[RED ${new Date().toISOString()}] projectOntologyGraph export missing`);
  process.exit(2);
}

function insertProject(db, id, repoRoot, gitRemote) {
  db.prepare(`
    INSERT INTO projects (id, repo_root, git_remote, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, repoRoot, gitRemote, nowIso, nowIso);
}

function insertConcept(db, concept) {
  db.prepare(`
    INSERT INTO concepts (
      id, project_id, kind, label, description, aliases_json, payload_json,
      created_at, updated_at, score, retention_class, manual_pin, ref_count, project_spread, first_seen, last_seen
    ) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    concept.id,
    concept.projectId,
    concept.kind,
    concept.label,
    concept.description,
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

function insertRelation(db, relation) {
  db.prepare(`
    INSERT INTO relations (
      id, project_id, source_type, source_id, target_type, target_id, relation, weight,
      payload_json, created_at, updated_at
    ) VALUES (?, ?, 'concept', ?, 'concept', ?, ?, ?, '{}', ?, ?)
  `).run(relation.id, relation.projectId, relation.sourceId, relation.targetId, relation.relation, relation.weight, relation.createdAt, relation.updatedAt);
}

function insertReference(db, reference) {
  db.prepare(`
    INSERT INTO memory_references (
      id, project_id, source_type, source_id, target_type, target_id, ref_kind, weight, created_at
    ) VALUES (?, ?, ?, ?, 'concept', ?, ?, ?, ?)
  `).run(
    reference.id,
    reference.projectId,
    reference.sourceType,
    reference.sourceId,
    reference.targetId,
    reference.refKind,
    reference.weight,
    reference.createdAt,
  );
}

const tempRoot = mkdtempSync(join(tmpdir(), "omo-t9-graph-"));
const dbPath = join(tempRoot, "state.sqlite");
const db = new Database(dbPath);

try {
  memoryDbMod.migrate(db);
  insertProject(db, "project-a", "/tmp/project-a", "https://token:[REDACTED]@example.com/project-a.git");
  insertProject(db, "project-b", "/tmp/project-b", "https://example.com/project-b.git");

  insertConcept(db, {
    id: "concept-a",
    projectId: "project-a",
    kind: "term",
    label: "SQLite Memory Ledger",
    description: "Shared ontology concept",
    payloadJson: '{"confidence":0.91}',
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    score: 87,
    retentionClass: "durable",
    manualPin: 0,
    refCount: 4,
    projectSpread: 2,
    firstSeen: "2026-06-01T00:00:00.000Z",
    lastSeen: "2026-06-28T00:00:00.000Z",
  });
  insertConcept(db, {
    id: "concept-b",
    projectId: "project-a",
    kind: "decision",
    label: "Graph Projection API",
    description: "Todo 9 API",
    payloadJson: '{"confidence":0.75}',
    createdAt: "2026-06-28T00:01:00.000Z",
    updatedAt: "2026-06-28T00:01:00.000Z",
    score: 64,
    retentionClass: "working",
    manualPin: 0,
    refCount: 2,
    projectSpread: 1,
    firstSeen: "2026-06-20T00:00:00.000Z",
    lastSeen: "2026-06-28T00:01:00.000Z",
  });
  insertConcept(db, {
    id: "concept-c",
    projectId: "project-b",
    kind: "artifact",
    label: "OpenTUI Viewer",
    description: "Future visualization surface with secret token=shouldredact123",
    payloadJson: '{"confidence":0.5}',
    createdAt: "2026-06-28T00:02:00.000Z",
    updatedAt: "2026-06-28T00:02:00.000Z",
    score: 35,
    retentionClass: "ephemeral",
    manualPin: 0,
    refCount: 1,
    projectSpread: 1,
    firstSeen: "2026-06-28T00:02:00.000Z",
    lastSeen: "2026-06-28T00:02:00.000Z",
  });
  insertRelation(db, {
    id: "relation-1",
    projectId: "project-a",
    sourceId: "concept-a",
    targetId: "concept-b",
    relation: "supports",
    weight: 0.8,
    createdAt: "2026-06-28T01:00:00.000Z",
    updatedAt: "2026-06-28T01:00:00.000Z",
  });
  insertRelation(db, {
    id: "relation-2",
    projectId: "project-b",
    sourceId: "concept-b",
    targetId: "concept-c",
    relation: "feeds",
    weight: 0.6,
    createdAt: "2026-06-28T01:01:00.000Z",
    updatedAt: "2026-06-28T01:01:00.000Z",
  });
  insertReference(db, {
    id: "ref-1",
    projectId: "project-a",
    sourceType: "event",
    sourceId: "event-1",
    targetId: "concept-a",
    refKind: "mentions",
    weight: 1,
    createdAt: "2026-06-28T02:00:00.000Z",
  });

  const graph = projectOntologyGraph({ dbPath });
  assertEqual(graph.nodes.length, 3, "node count");
  assertEqual(graph.edges.length, 2, "edge count");
  assertDeepEqual(
    graph.nodes.map((node) => node.id),
    ["concept-b", "concept-c", "concept-a"],
    "deterministic node ordering",
  );
  assertDeepEqual(
    graph.edges.map((edge) => edge.id),
    ["relation-2", "relation-1"],
    "deterministic edge ordering",
  );

  const firstNode = graph.nodes[0];
  assertEqual(firstNode.label, "Graph Projection API", "node label");
  assertEqual(firstNode.scoreLabel, "64 working", "node score label");
  assertEqual(firstNode.project.id, "project-a", "node project provenance");
  assertEqual(firstNode.project.gitRemote, "https://[REDACTED]@example.com/project-a.git", "sanitized project provenance");
  assertEqual(firstNode.selected, true, "first node selected by default");
  assertEqual(graph.detail?.id, "concept-b", "detail follows selected node");
  assertEqual(graph.edges[0].label, "feeds 0.60", "edge score label");

  const queryGraph = projectOntologyGraph({ dbPath, query: "sqlite" });
  assertDeepEqual(
    queryGraph.nodes.map((node) => node.id),
    ["concept-a"],
    "query narrows nodes",
  );
  assertEqual(queryGraph.edges.length, 0, "query excludes disconnected relations");

  const serialized = JSON.stringify(graph);
  if (serialized.includes("shouldredact123") || serialized.includes("token=shouldredact123")) {
    fail("raw secret-like text leaked through graph projection");
  }

  const emptyRoot = mkdtempSync(join(tmpdir(), "omo-t9-empty-"));
  const emptyDbPath = join(emptyRoot, "state.sqlite");
  const emptyDb = new Database(emptyDbPath);
  try {
    memoryDbMod.migrate(emptyDb);
  } finally {
    emptyDb.close();
  }
  const emptyGraph = projectOntologyGraph({ dbPath: emptyDbPath });
  assertEqual(emptyGraph.nodes.length, 0, "empty node count");
  assertEqual(emptyGraph.edges.length, 0, "empty edge count");
  assertEqual(emptyGraph.message, "No ontology graph data is available yet.", "empty message");
  rmSync(emptyRoot, { recursive: true, force: true });

  writeEvidence(`[GREEN ${new Date().toISOString()}] graph projection verifier passed: nodes=3 edges=2 empty=0 query=sqlite`);
  console.log("VERIFY PASS (ontology graph projection + deterministic ordering + empty graph + secret redaction)");
} finally {
  db.close();
  rmSync(tempRoot, { recursive: true, force: true });
  console.log("CLEANUP: removed", tempRoot);
}
