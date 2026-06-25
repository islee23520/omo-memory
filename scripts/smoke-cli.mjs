#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "omo-memory-cli-"));
const dbPath = join(tempDir, "state.sqlite");
const env = { ...process.env, OMO_MEMORY_DB: dbPath };

function runCli(args, cwd = root) {
  const result = spawnSync(process.execPath, [join(root, "dist", "cli.js"), ...args], { cwd, env, encoding: "utf8" });
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
  if (init.dbPath !== dbPath || init.schemaVersion !== 1) throw new Error("init returned unexpected metadata");
  pass("init");

  const doctor = requireOk("doctor", runCli(["doctor"]));
  if (doctor.paths?.dbPath !== dbPath || doctor.schemaVersion !== 1 || doctor.project?.id === undefined) throw new Error("doctor returned unexpected report");
  pass("doctor");

  const tokenRemoteRepo = mkdtempSync(join(tempDir, "token-remote-"));
  runGit(["init"], tokenRemoteRepo);
  runGit(["remote", "add", "origin", "https://github_pat_SECRET1234567890@github.com/islee23520/private.git"], tokenRemoteRepo);
  const tokenRemoteDoctor = requireOk("doctor token remote redaction", runCli(["doctor"], tokenRemoteRepo));
  const tokenRemoteJson = JSON.stringify(tokenRemoteDoctor);
  if (tokenRemoteJson.includes("github_pat_SECRET1234567890") || !tokenRemoteJson.includes("[REDACTED]")) throw new Error("doctor leaked token-bearing git remote");
  pass("doctor token remote redaction");

  const rawRemote = "https://github_pat_SECRET1234567890@github.com/islee23520/private.git";
  const db = new Database(dbPath);
  try {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO projects (id, repo_root, git_remote, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(tokenRemoteDoctor.project.id, tokenRemoteRepo, rawRemote, now, now);
    db.prepare("INSERT INTO events (id, project_id, type, summary, created_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), tokenRemoteDoctor.project.id, "legacy.raw_remote", "legacy event", now);
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

  const event = requireOk("event record", runCli(["event", "record", "--type", "smoke.cli", "--summary", "CLI smoke token=sk-test1234567890", "--payload-json", "{\"api_key\":\"secret123456\"}", "--session-id", session.sessionId]));
  if (typeof event.eventId !== "string" || event.eventId.length === 0) throw new Error("event record did not return eventId");
  pass("event record");

  const handoff = requireOk("handoff write", runCli(["handoff", "write", "--summary", "CLI smoke handoff Bearer abcdef123456", "--session-id", session.sessionId]));
  if (typeof handoff.handoffId !== "string" || handoff.handoffId.length === 0) throw new Error("handoff write did not return handoffId");
  pass("handoff write");

  const recent = requireOk("recent", runCli(["recent", "--limit", "5"]));
  if (!Array.isArray(recent.events) || !recent.events.some((item) => item.summary.includes("[REDACTED]"))) throw new Error("recent did not include redacted smoke event");
  pass("recent");

  const exported = requireOk("export", runCli(["export"]));
  if (!Array.isArray(exported.events) || !JSON.stringify(exported).includes("[REDACTED]")) throw new Error("export did not include redacted data");
  pass("export");

  const purge = requireOk("purge", runCli(["purge", "--yes"]));
  if (purge.deleted?.events < 1 || purge.deleted?.handoffs < 1 || purge.deleted?.sessions < 1) throw new Error("purge did not delete expected rows");
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
