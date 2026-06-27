#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "omo-memory-cli-"));
const dbPath = join(tempDir, "state.sqlite");
const env = { ...process.env, OMO_MEMORY_DB: dbPath };
const envProjectDefault = { ...process.env };
delete envProjectDefault.OMO_MEMORY_DB;

function runCli(args, cwd = root) {
  const result = spawnSync(process.execPath, [join(root, "dist", "cli.js"), ...args], { cwd, env, encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

function runCliProjectDefault(args, cwd) {
  const result = spawnSync(process.execPath, [join(root, "dist", "cli.js"), ...args], { cwd, env: envProjectDefault, encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} exited ${result.status ?? "null"}: ${result.stderr.trim()}`);
}

function requireOk(label, result) {
  if (result.status !== 0) throw new Error(`${label} exited ${result.status ?? "null"}: ${result.stderr.trim()}`);
  const parsed = JSON.parse(result.stdout);
  if (parsed.ok !== true) throw new Error(`${label} did not return ok=true`);
  return parsed;
}

function pass(label) {
  process.stdout.write(`smoke-cli PASS ${label}\n`);
}

try {
  const init = requireOk("init", runCli(["init"]));
  if (init.dbPath !== dbPath || init.schemaVersion !== 2) throw new Error("init returned unexpected metadata");
  pass("init");

  const doctor = requireOk("doctor", runCli(["doctor"]));
  if (doctor.paths?.dbPath !== dbPath || doctor.schemaVersion !== 2 || doctor.project?.id === undefined) throw new Error("doctor returned unexpected report");
  if (
    doctor.counts?.concepts !== 0 ||
    doctor.counts?.relations !== 0 ||
    doctor.counts?.durableMemories !== 0 ||
    doctor.counts?.decisionRecords !== 0
  )
    throw new Error("doctor returned unexpected ontology counts");
  pass("doctor");

  const projectDefaultRepo = mkdtempSync(join(tempDir, "project-default-"));
  runGit(["init"], projectDefaultRepo);
  const projectDefault = requireOk("project-local default path", runCliProjectDefault(["doctor"], projectDefaultRepo));
  if (projectDefault.paths?.dbPath !== join(projectDefault.project.repoRoot, ".omo", "memory", "state.sqlite"))
    throw new Error("default DB path was not project-local");
  pass("project-local default path");

  const movableRepo = mkdtempSync(join(tempDir, "movable-project-"));
  runGit(["init"], movableRepo);
  runGit(["remote", "add", "origin", "https://github.com/islee23520/movable-project.git"], movableRepo);
  requireOk(
    "moved project event seed",
    runCliProjectDefault(["event", "record", "--type", "move.smoke", "--summary", "memory survives project move"], movableRepo),
  );
  const movedRepo = join(tempDir, "movable-project-renamed");
  renameSync(movableRepo, movedRepo);
  const movedRecent = requireOk("moved project recent", runCliProjectDefault(["recent", "--limit", "5"], movedRepo));
  if (!Array.isArray(movedRecent.events) || !movedRecent.events.some((item) => item.summary === "memory survives project move")) {
    throw new Error("moved project did not migrate existing memory");
  }
  const movedDoctor = requireOk("moved project doctor", runCliProjectDefault(["doctor"], movedRepo));
  if (movedDoctor.counts?.projects !== 1) throw new Error("moved project migration left duplicate project rows");
  pass("moved project migration");

  const tokenRemoteRepo = mkdtempSync(join(tempDir, "token-remote-"));
  runGit(["init"], tokenRemoteRepo);
  runGit(["remote", "add", "origin", "https://github_pat_SECRET1234567890@github.com/islee23520/private.git"], tokenRemoteRepo);
  const tokenRemoteDoctor = requireOk("doctor token remote redaction", runCli(["doctor"], tokenRemoteRepo));
  const tokenRemoteJson = JSON.stringify(tokenRemoteDoctor);
  if (tokenRemoteJson.includes("github_pat_SECRET1234567890") || !tokenRemoteJson.includes("[REDACTED]"))
    throw new Error("doctor leaked token-bearing git remote");
  pass("doctor token remote redaction");

  const rawRemote = "https://github_pat_SECRET1234567890@github.com/islee23520/private.git";
  const db = new Database(dbPath);
  try {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO projects (id, repo_root, git_remote, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
      tokenRemoteDoctor.project.id,
      tokenRemoteRepo,
      rawRemote,
      now,
      now,
    );
    db.prepare("INSERT INTO events (id, project_id, type, summary, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomUUID(),
      tokenRemoteDoctor.project.id,
      "legacy.raw_remote",
      "legacy event",
      now,
    );
  } finally {
    db.close();
  }
  const legacyPurge = requireOk("legacy raw remote purge", runCli(["purge", "--yes"], tokenRemoteRepo));
  if (legacyPurge.deleted?.events < 1 || legacyPurge.deleted?.projects < 1) throw new Error("purge missed legacy raw remote rows");
  const legacyAfter = new Database(dbPath, { readonly: true });
  try {
    const rawRows = legacyAfter.prepare("SELECT COUNT(*) FROM projects WHERE git_remote = ?").pluck().get(rawRemote);
    if (rawRows !== 0) throw new Error("legacy raw remote row remained after purge");
  } finally {
    legacyAfter.close();
  }
  pass("legacy raw remote purge");

  const session = requireOk("session start", runCli(["session", "start", "--host", "codex", "--adapter", "smoke-cli"]));
  if (typeof session.sessionId !== "string" || session.sessionId.length === 0) throw new Error("session start did not return sessionId");
  pass("session start");

  const bootstrap = requireOk("session bootstrap", runCli(["session", "bootstrap", "--host", "codex", "--adapter", "smoke-cli", "--limit", "5"]));
  if (typeof bootstrap.sessionId !== "string" || !Array.isArray(bootstrap.recentEvents)) throw new Error("session bootstrap returned unexpected payload");
  pass("session bootstrap");

  const event = requireOk(
    "event record",
    runCli([
      "event",
      "record",
      "--type",
      "smoke.cli",
      "--summary",
      "CLI smoke token=sk-test1234567890",
      "--payload-json",
      '{"api_key":"secret123456"}',
      "--session-id",
      session.sessionId,
    ]),
  );
  if (typeof event.eventId !== "string" || event.eventId.length === 0) throw new Error("event record did not return eventId");
  pass("event record");

  const handoff = requireOk(
    "handoff write",
    runCli(["handoff", "write", "--summary", "CLI smoke handoff Bearer abcdef123456", "--session-id", session.sessionId]),
  );
  if (typeof handoff.handoffId !== "string" || handoff.handoffId.length === 0) throw new Error("handoff write did not return handoffId");
  pass("handoff write");

  const ontologyDb = new Database(dbPath);
  try {
    const now = new Date().toISOString();
    ontologyDb
      .prepare(
        "INSERT INTO concepts (id, project_id, kind, label, description, aliases_json, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("concept-smoke", event.project.id, "practice", "Local ledger", "Project-local durable memory", '["ledger"]', "{}", now, now);
    ontologyDb
      .prepare(
        "INSERT INTO durable_memories (id, project_id, type, summary, body, source_event_id, confidence, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("memory-smoke", event.project.id, "preference", "Prefer local-first memory", "Keep OMO Memory local by default", event.eventId, 0.9, "active", now, now);
    ontologyDb
      .prepare(
        "INSERT INTO decision_records (id, project_id, title, rationale, status, source_event_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("decision-smoke", event.project.id, "Use ontology schema", "Graph-shaped memory needs first-class rows", "active", event.eventId, now, now);
    ontologyDb
      .prepare(
        "INSERT INTO relations (id, project_id, source_type, source_id, target_type, target_id, relation, weight, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("relation-smoke", event.project.id, "decision_record", "decision-smoke", "concept", "concept-smoke", "describes", 1, "{}", now, now);
  } finally {
    ontologyDb.close();
  }
  pass("ontology seed");

  const recent = requireOk("recent", runCli(["recent", "--limit", "5"]));
  if (!Array.isArray(recent.events) || !recent.events.some((item) => item.summary.includes("[REDACTED]")))
    throw new Error("recent did not include redacted smoke event");
  pass("recent");

  const exported = requireOk("export", runCli(["export"]));
  if (!Array.isArray(exported.events) || !JSON.stringify(exported).includes("[REDACTED]")) throw new Error("export did not include redacted data");
  if (
    !Array.isArray(exported.concepts) ||
    exported.concepts.length !== 1 ||
    !Array.isArray(exported.relations) ||
    exported.relations.length !== 1 ||
    !Array.isArray(exported.durableMemories) ||
    exported.durableMemories.length !== 1 ||
    !Array.isArray(exported.decisionRecords) ||
    exported.decisionRecords.length !== 1
  )
    throw new Error("export did not include ontology rows");
  pass("export");

  const purge = requireOk("purge", runCli(["purge", "--yes"]));
  if (
    purge.deleted?.events < 1 ||
    purge.deleted?.handoffs < 1 ||
    purge.deleted?.sessions < 1 ||
    purge.deleted?.concepts !== 1 ||
    purge.deleted?.relations !== 1 ||
    purge.deleted?.durableMemories !== 1 ||
    purge.deleted?.decisionRecords !== 1
  )
    throw new Error("purge did not delete expected rows");
  pass("purge");

  const after = requireOk("recent after purge", runCli(["recent"]));
  if (!Array.isArray(after.events) || after.events.length !== 0) throw new Error("recent after purge was not empty");
  pass("recent after purge");

  const afterDoctor = requireOk("doctor after recent", runCli(["doctor"]));
  if (afterDoctor.counts?.projects !== 0) throw new Error("recent recreated a project row after purge");
  pass("recent read only");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
  pass("cleanup");
}
