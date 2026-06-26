#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "omo-memory-cli-"));
const dbPath = join(tempDir, "state.sqlite");
const installHome = join(tempDir, "home");
const env = { ...process.env, OMO_MEMORY_DB: dbPath, OMO_MEMORY_INSTALL_HOME: installHome };
const envProjectDefault = { ...process.env, OMO_MEMORY_INSTALL_HOME: installHome };
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
  if (init.dbPath !== dbPath || init.schemaVersion !== 1) throw new Error("init returned unexpected metadata");
  pass("init");

  const doctor = requireOk("doctor", runCli(["doctor"]));
  if (doctor.paths?.dbPath !== dbPath || doctor.schemaVersion !== 1 || doctor.project?.id === undefined) throw new Error("doctor returned unexpected report");
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

  const hooks = requireOk("hooks install", runCli(["hooks", "install", "--host", "all"]));
  if (!Array.isArray(hooks.installed) || hooks.installed.length !== 2) throw new Error("hooks install did not install both hosts");
  const codexSkill = join(installHome, ".codex", "skills", "omo-memory", "SKILL.md");
  const codexPlugin = join(installHome, ".codex", "local-marketplaces", "islee23520", "plugins", "omo-memory", ".codex-plugin", "plugin.json");
  const codexHook = join(installHome, ".codex", "local-marketplaces", "islee23520", "plugins", "omo-memory", "hooks", "hooks.json");
  const codexHookScript = join(installHome, ".codex", "local-marketplaces", "islee23520", "plugins", "omo-memory", "scripts", "omo-memory-session.mjs");
  const codexMarketplace = join(installHome, ".codex", "local-marketplaces", "islee23520", ".agents", "plugins", "marketplace.json");
  const codexConfig = join(installHome, ".codex", "config.toml");
  const grokHook = join(installHome, ".grok", "hooks", "omo-memory-hooks.json");
  const grokPlugin = join(installHome, ".grok", "plugins", "omo-memory", "plugin.json");
  const grokPluginHook = join(installHome, ".grok", "plugins", "omo-memory", "hooks", "hooks.json");
  const grokPluginMcp = join(installHome, ".grok", "plugins", "omo-memory", ".mcp.json");
  if (
    !existsSync(codexSkill) ||
    !existsSync(codexPlugin) ||
    !existsSync(codexHook) ||
    !existsSync(codexHookScript) ||
    !existsSync(codexMarketplace) ||
    !existsSync(codexConfig) ||
    !existsSync(grokHook) ||
    !existsSync(grokPlugin) ||
    !existsSync(grokPluginHook) ||
    !existsSync(grokPluginMcp)
  ) {
    throw new Error("hooks install missed expected files");
  }
  if (!readFileSync(codexHook, "utf8").includes("SessionStart")) throw new Error("codex hook did not define SessionStart");
  if (!readFileSync(codexHookScript, "utf8").includes('--host", host')) throw new Error("codex hook script did not reference bootstrap host");
  if (!readFileSync(codexMarketplace, "utf8").includes("omo-memory")) throw new Error("codex marketplace did not include omo-memory");
  if (!readFileSync(codexConfig, "utf8").includes('[plugins."omo-memory@islee23520"]')) throw new Error("codex config did not enable omo-memory plugin");
  if (!readFileSync(grokHook, "utf8").includes("omo-memory-session.mjs")) throw new Error("grok hook did not reference session script");
  if (!readFileSync(grokPlugin, "utf8").includes('"mcpServers": "./.mcp.json"')) throw new Error("grok plugin did not declare MCP config");
  if (!readFileSync(grokPluginHook, "utf8").includes("SessionStart")) throw new Error("grok plugin did not define SessionStart");
  if (!readFileSync(grokPluginMcp, "utf8").includes('"omo-memory"')) throw new Error("grok plugin did not bundle omo-memory MCP config");
  pass("hooks install");

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

  const recent = requireOk("recent", runCli(["recent", "--limit", "5"]));
  if (!Array.isArray(recent.events) || !recent.events.some((item) => item.summary.includes("[REDACTED]")))
    throw new Error("recent did not include redacted smoke event");
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
