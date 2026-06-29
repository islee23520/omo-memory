#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, "dist", "cli.js");
const evidencePath = join(root, ".omo", "evidence", "omo-memory-second-brain-retention", "task-10-opentui-graph.txt");
const nowIso = "2026-06-29T00:00:00.000Z";

mkdirSync(dirname(evidencePath), { recursive: true });

function evidence(line) {
  appendFileSync(evidencePath, `${line}\n`);
}

function fail(message) {
  evidence(`[FAIL ${new Date().toISOString()}] ${message}`);
  console.error("VERIFY FAIL:", message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) fail(`${label}: missing ${needle}`);
}

function assertCleanTmux(session) {
  const result = run("tmux", ["has-session", "-t", session]);
  if (result.status === 0) fail(`tmux session still running: ${session}`);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function ensureTmux() {
  const result = run("tmux", ["-V"]);
  if (result.status !== 0) fail(`tmux unavailable: ${result.stderr || result.stdout}`);
  evidence(`[QA ${new Date().toISOString()}] tmux available: ${result.stdout.trim()}`);
}

function insertProject(db) {
  db.prepare(`
    INSERT INTO projects (id, repo_root, git_remote, created_at, last_seen_at)
    VALUES ('project-opentui', '/tmp/opentui-project', 'https://example.com/opentui.git', ?, ?)
  `).run(nowIso, nowIso);
}

function insertConcept(db, concept) {
  db.prepare(`
    INSERT INTO concepts (
      id, project_id, kind, label, description, aliases_json, payload_json,
      created_at, updated_at, score, retention_class, manual_pin, ref_count, project_spread, first_seen, last_seen
    ) VALUES (?, 'project-opentui', ?, ?, ?, '[]', '{}', ?, ?, ?, ?, 0, ?, 1, ?, ?)
  `).run(concept.id, concept.kind, concept.label, concept.description, nowIso, nowIso, concept.score, concept.retentionClass, concept.refCount, nowIso, nowIso);
}

function insertRelation(db, id, sourceId, targetId, relation) {
  db.prepare(`
    INSERT INTO relations (
      id, project_id, source_type, source_id, target_type, target_id, relation, weight,
      payload_json, created_at, updated_at
    ) VALUES (?, 'project-opentui', 'concept', ?, 'concept', ?, ?, 0.75, '{}', ?, ?)
  `).run(id, sourceId, targetId, relation, nowIso, nowIso);
}

async function pause(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureUntil(session, expected) {
  const deadline = Date.now() + 5000;
  let lastCapture = "";
  while (Date.now() < deadline) {
    const capture = run("tmux", ["capture-pane", "-p", "-S", "-200", "-E", "200", "-t", session]);
    if (capture.status !== 0) fail(`tmux capture failed: ${capture.stderr || capture.stdout}`);
    lastCapture = capture.stdout;
    if (expected.every((item) => lastCapture.includes(item))) return lastCapture;
    await pause(250);
  }
  return lastCapture;
}

async function captureScenario({ name, dbPath, query, expected }) {
  const session = `ulw-qa-${name}-${process.pid}`;
  const command = ["node", shellQuote(cli), "graph", "tui", "--db", shellQuote(dbPath)];
  if (query !== undefined) command.push("--query", shellQuote(query));
  const args = ["new-session", "-d", "-x", "120", "-y", "40", "-s", session, command.join(" ")];
  const start = run("tmux", args);
  if (start.status !== 0) fail(`${name} tmux start failed: ${start.stderr || start.stdout}`);
  try {
    const stdout = await captureUntil(session, expected);
    evidence(`[QA ${new Date().toISOString()}] ${name} pane capture BEGIN`);
    evidence(stdout);
    evidence(`[QA ${new Date().toISOString()}] ${name} pane capture END`);
    for (const item of expected) assertIncludes(stdout, item, `${name} capture`);
    const quit = run("tmux", ["send-keys", "-t", session, "q"]);
    if (quit.status !== 0) fail(`${name} tmux q failed: ${quit.stderr || quit.stdout}`);
    await pause(800);
    assertCleanTmux(session);
    evidence(`[QA ${new Date().toISOString()}] ${name} q exit PASS`);
  } finally {
    run("tmux", ["kill-session", "-t", session]);
  }
}

if (!existsSync(cli)) fail("dist/cli.js missing; run npm run build first");
ensureTmux();

const tempRoot = mkdtempSync(join(tmpdir(), "omo-t10-opentui-"));
try {
  const memoryDbMod = await import(join(root, "dist", "memoryDb.js"));
  const dbPath = join(tempRoot, "state.sqlite");
  const db = new Database(dbPath);
  try {
    memoryDbMod.migrate(db);
    insertProject(db);
    insertConcept(db, {
      id: "concept-ontology",
      kind: "term",
      label: "Ontology Graph",
      description: "OpenTUI graph surface",
      score: 91,
      retentionClass: "durable",
      refCount: 5,
    });
    insertConcept(db, {
      id: "concept-opentui",
      kind: "tool",
      label: "Ontology Viewer",
      description: "Terminal graph renderer",
      score: 70,
      retentionClass: "working",
      refCount: 3,
    });
    insertConcept(db, {
      id: "concept-detail",
      kind: "pane",
      label: "Ontology Detail Pane",
      description: "Selected concept metadata",
      score: 44,
      retentionClass: "ephemeral",
      refCount: 1,
    });
    insertRelation(db, "relation-1", "concept-ontology", "concept-opentui", "renders");
    insertRelation(db, "relation-2", "concept-opentui", "concept-detail", "explains");
  } finally {
    db.close();
  }

  await captureScenario({
    name: "happy",
    dbPath,
    query: "ontology",
    expected: ["OMO Ontology Graph", "Graph", "●Ontology D", "DOntology G", "WOntology V", "------", "Legend: D durable", "Detail", "Retention:"],
  });

  const emptyDbPath = join(tempRoot, "empty.sqlite");
  const emptyDb = new Database(emptyDbPath);
  try {
    memoryDbMod.migrate(emptyDb);
  } finally {
    emptyDb.close();
  }
  await captureScenario({
    name: "empty",
    dbPath: emptyDbPath,
    expected: ["OMO Ontology Graph", "No ontology graph data is available yet.", "Detail Pane"],
  });

  evidence(`[GREEN ${new Date().toISOString()}] OpenTUI graph verifier passed: happy render + empty graph + q cleanup`);
  console.log("VERIFY PASS (OpenTUI graph tui tmux happy + empty + cleanup)");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
  evidence(`[CLEANUP ${new Date().toISOString()}] removed ${tempRoot}`);
}
