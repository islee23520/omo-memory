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
const env = { ...process.env, OMO_MEMORY_AUTO_UPDATE: "0", OMO_MEMORY_DB: dbPath };
const envProjectDefault = { ...process.env };
envProjectDefault.OMO_MEMORY_AUTO_UPDATE = "0";
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
  if (init.dbPath !== dbPath || init.schemaVersion !== 3) throw new Error("init returned unexpected metadata");
  pass("init");

  const doctor = requireOk("doctor", runCli(["doctor"]));
  if (doctor.paths?.dbPath !== dbPath || doctor.schemaVersion !== 3 || doctor.project?.id === undefined) throw new Error("doctor returned unexpected report");
  if (doctor.counts?.concepts !== 0 || doctor.counts?.relations !== 0 || doctor.counts?.durableMemories !== 0 || doctor.counts?.decisionRecords !== 0)
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

  const globalDbPath = join(tempDir, "global.sqlite");
  const globalScan = requireOk("global scan", runCli(["global", "scan", "--root", tempDir, "--json"]));
  if (!Array.isArray(globalScan.candidates) || globalScan.candidates.length < 1) throw new Error("global scan found no candidate DBs");
  pass("global scan");
  const globalMigrate = requireOk("global migrate", runCli(["global", "migrate", "--root", tempDir, "--global-db", globalDbPath, "--json"]));
  if (globalMigrate.after?.sources < 1) throw new Error("global migrate imported no sources");
  pass("global migrate");
  const globalList = requireOk("global list", runCli(["global", "list", "--global-db", globalDbPath, "--json"]));
  if (typeof globalList.counts?.sources !== "number" || !Array.isArray(globalList.sources)) throw new Error("global list returned malformed result");
  pass("global list");

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
  if (typeof bootstrap.sessionId !== "string" || "recentEvents" in bootstrap) throw new Error("session bootstrap should not return recentEvents");
  pass("session bootstrap");

  const event = requireOk(
    "event record",
    runCli([
      "event",
      "record",
      "--type",
      "user_action",
      "--summary",
      "CLI smoke event ledger token=sk-test1234567890",
      "--payload-json",
      '{"api_key":"secret123456"}',
      "--session-id",
      session.sessionId,
    ]),
  );
  if (typeof event.eventId !== "string" || event.eventId.length === 0) throw new Error("event record did not return eventId");
  pass("event record");

  const help = spawnSync(process.execPath, [join(root, "dist", "cli.js"), "help"], { cwd: root, env, encoding: "utf8" });
  if (help.status !== 0 || !help.stdout.includes("global migrate")) throw new Error("help did not list retained lifecycle commands");
  if (help.stdout.includes("ontology") || help.stdout.includes("graph tui")) throw new Error("help listed removed ontology/graph commands");
  pass("help lifecycle commands");

  const removedOntology = runCli(["ontology", "candidates"]);
  if (removedOntology.status === 0 || !removedOntology.stdout.includes("unknown command: ontology candidates")) {
    throw new Error(`ontology command was not removed: ${removedOntology.stdout}`);
  }
  const removedGraph = runCli(["graph", "tui"]);
  if (removedGraph.status === 0 || !removedGraph.stdout.includes("unknown command: graph tui")) {
    throw new Error(`graph command was not removed: ${removedGraph.stdout}`);
  }
  pass("removed ontology/graph commands");

  const handoff = requireOk(
    "handoff write",
    runCli(["handoff", "write", "--summary", "CLI smoke handoff Bearer abcdef123456", "--session-id", session.sessionId]),
  );
  if (typeof handoff.handoffId !== "string" || handoff.handoffId.length === 0) throw new Error("handoff write did not return handoffId");
  pass("handoff write");

  const recent = requireOk("recent", runCli(["recent", "--limit", "5"]));
  if (!Array.isArray(recent.events) || !recent.events.some((item) => item.summary.includes("[REDACTED]")))
    throw new Error("recent did not include redacted smoke event");
  pass("recent");

  const recall = requireOk("recall", runCli(["recall", "--query", "CLI smoke", "--limit", "5"]));
  if (!Array.isArray(recall.events) || !recall.events.some((item) => item.summary.includes("[REDACTED]")))
    throw new Error("recall did not include matching redacted smoke event");
  const unrelatedRecall = requireOk("recall unrelated", runCli(["recall", "--query", "unrelated watercolor calendar", "--limit", "5"]));
  if (!Array.isArray(unrelatedRecall.events) || unrelatedRecall.events.length !== 0) throw new Error("recall returned unrelated events");
  const genericHookRecall = requireOk("recall generic hook words", runCli(["recall", "--query", "unrelated user action profile button", "--limit", "5"]));
  if (!Array.isArray(genericHookRecall.events) || genericHookRecall.events.length !== 0) throw new Error("recall matched generic hook words");
  const underscoreRecall = requireOk("recall underscore literal", runCli(["recall", "--query", "user_action", "--limit", "5"]));
  if (!Array.isArray(underscoreRecall.events) || underscoreRecall.events.length !== 0) throw new Error("recall treated underscore as wildcard");
  const wildcardRecall = requireOk("recall wildcard literal", runCli(["recall", "--query", "___", "--limit", "5"]));
  if (!Array.isArray(wildcardRecall.events) || wildcardRecall.events.length !== 0) throw new Error("recall treated wildcard query as pattern");
  pass("recall");

  const exported = requireOk("export", runCli(["export"]));
  if (!Array.isArray(exported.events) || !JSON.stringify(exported).includes("[REDACTED]")) throw new Error("export did not include redacted data");
  if (exported.concepts.length !== 0 || exported.relations.length !== 0 || exported.durableMemories.length !== 0 || exported.decisionRecords.length !== 0) {
    throw new Error("fresh export included ontology rows");
  }
  pass("export");

  const purge = requireOk("purge", runCli(["purge", "--yes"]));
  if (
    purge.deleted?.events < 1 ||
    purge.deleted?.handoffs < 1 ||
    purge.deleted?.sessions < 1 ||
    purge.deleted?.concepts !== 0 ||
    purge.deleted?.relations !== 0 ||
    purge.deleted?.durableMemories !== 0 ||
    purge.deleted?.decisionRecords !== 0
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
