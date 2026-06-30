#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, "dist", "cli.js");
const evidencePath = join(root, ".omo", "evidence", "omo-memory-core-ledger", "task-7-cli-lifecycle.txt");

function fail(message) {
  throw new Error(`VERIFY FAIL: ${message}`);
}

function runCli(args, cwd, env = process.env) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

function jsonOk(label, result) {
  if (result.status !== 0) fail(`${label} exited ${result.status}: ${result.stderr.trim()} ${result.stdout.trim()}`);
  const parsed = JSON.parse(result.stdout);
  if (parsed.ok !== true) fail(`${label} did not return ok=true: ${result.stdout}`);
  return parsed;
}

function jsonFail(label, result) {
  if (result.status === 0) fail(`${label} unexpectedly exited 0`);
  const parsed = JSON.parse(result.stdout);
  if (parsed.ok !== false || typeof parsed.error !== "string") fail(`${label} did not return JSON error: ${result.stdout}`);
  return parsed;
}

function requireHelp(help, text) {
  if (!help.includes(text)) fail(`help output missing ${text}`);
}

function rejectHelp(help, text) {
  if (help.includes(text)) fail(`help output still lists removed surface ${text}`);
}

const tempRoot = mkdtempSync(join(tmpdir(), "omo-t7-cli-"));
try {
  const workspace = join(tempRoot, "workspace");
  const globalDb = join(tempRoot, "global.sqlite");
  const stateDb = join(workspace, ".omo", "memory", "state.sqlite");
  const env = { ...process.env, OMO_MEMORY_DB: stateDb };
  const gitInit = spawnSync("git", ["init", workspace], { encoding: "utf8" });
  if (gitInit.status !== 0) fail(`git init failed: ${gitInit.stderr}`);
  writeFileSync(join(workspace, "dirty.txt"), "dirty_worktree fixture\n");

  const help = runCli(["help"], workspace, env);
  if (help.status !== 0) fail(`help exited ${help.status}: ${help.stderr}`);
  for (const text of [
    "omo-memory init",
    "omo-memory doctor",
    "omo-memory export",
    "omo-memory purge --yes",
    "omo-memory global scan --root <path>",
    "omo-memory global migrate --root <path> --global-db <path>",
    "omo-memory global list --global-db <path>",
    "omo-memory session start",
    "omo-memory session bootstrap",
    "omo-memory event record",
    "omo-memory recent",
    "omo-memory recall --query <text>",
    "omo-memory handoff write",
  ]) {
    requireHelp(help.stdout, text);
  }
  rejectHelp(help.stdout, "ontology");
  rejectHelp(help.stdout, "graph tui");

  const init = jsonOk("init", runCli(["init"], workspace, env));
  if (init.dbPath !== stateDb) fail(`init returned wrong db path: ${JSON.stringify(init)}`);
  const doctor = jsonOk("doctor", runCli(["doctor"], workspace, env));
  if (doctor.paths?.dbPath !== stateDb) fail(`doctor returned wrong db path: ${JSON.stringify(doctor)}`);

  const session = jsonOk("session start", runCli(["session", "start", "--host", "codex", "--adapter", "core-ledger-cli"], workspace, env));
  if (typeof session.sessionId !== "string") fail("session start did not return sessionId");
  const bootstrap = jsonOk(
    "session bootstrap",
    runCli(["session", "bootstrap", "--host", "codex", "--adapter", "core-ledger-cli", "--limit", "5"], workspace, env),
  );
  if (typeof bootstrap.sessionId !== "string" || "recentEvents" in bootstrap) fail(`bootstrap returned unexpected shape: ${JSON.stringify(bootstrap)}`);

  const eventOne = jsonOk(
    "event record decision",
    runCli(
      ["event", "record", "--type", "decision", "--summary", "Core ledger records local session events", "--session-id", session.sessionId],
      workspace,
      env,
    ),
  );
  const eventTwo = jsonOk(
    "event record qa",
    runCli(
      [
        "event",
        "record",
        "--type",
        "qa",
        "--summary",
        "Core ledger redacts token=sk-test1234567890 during recall and export",
        "--session-id",
        session.sessionId,
      ],
      workspace,
      env,
    ),
  );
  if (typeof eventOne.eventId !== "string" || typeof eventTwo.eventId !== "string") fail("event record did not return event ids");

  const handoff = jsonOk(
    "handoff write",
    runCli(["handoff", "write", "--summary", "Core ledger handoff summary with token=sk-test1234567890", "--session-id", session.sessionId], workspace, env),
  );
  if (typeof handoff.handoffId !== "string") fail("handoff write did not return handoffId");

  const recent = jsonOk("recent", runCli(["recent", "--limit", "5"], workspace, env));
  if (!Array.isArray(recent.events) || recent.events.length !== 2) fail(`recent returned wrong events: ${JSON.stringify(recent)}`);
  if (JSON.stringify(recent).includes("sk-test1234567890") || !JSON.stringify(recent).includes("[REDACTED]")) fail("recent did not redact event secret");

  const recall = jsonOk("recall", runCli(["recall", "--query", "core ledger", "--limit", "5"], workspace, env));
  if (!Array.isArray(recall.events) || recall.events.length < 2) fail(`recall missed ledger events: ${JSON.stringify(recall)}`);
  if (JSON.stringify(recall).includes("sk-test1234567890")) fail("recall leaked raw secret");

  const exported = jsonOk("export", runCli(["export"], workspace, env));
  if (exported.sessions.length !== 2 || exported.events.length !== 2 || exported.handoffs.length !== 1)
    fail(`export counts mismatch: ${JSON.stringify(exported)}`);
  if (JSON.stringify(exported).includes("sk-test1234567890")) fail("export leaked raw secret");

  const scan = jsonOk("global scan", runCli(["global", "scan", "--root", tempRoot, "--json"], workspace, env));
  if (!Array.isArray(scan.candidates) || scan.candidates.length !== 1) fail(`scan candidates mismatch: ${JSON.stringify(scan)}`);
  const migrated = jsonOk("global migrate", runCli(["global", "migrate", "--root", tempRoot, "--global-db", globalDb, "--json"], workspace, env));
  if (migrated.after?.events !== 2 || migrated.after?.handoffs !== 1 || migrated.after?.sessions !== 2) {
    fail(`global migrate counts mismatch: ${JSON.stringify(migrated)}`);
  }
  const migratedAgain = jsonOk(
    "global migrate idempotent",
    runCli(["global", "migrate", "--root", tempRoot, "--global-db", globalDb, "--json"], workspace, env),
  );
  if (migratedAgain.after?.events !== migrated.after.events || migratedAgain.after?.sources !== migrated.after.sources)
    fail("global migrate was not idempotent");
  const globalList = jsonOk("global list", runCli(["global", "list", "--global-db", globalDb, "--json"], workspace, env));
  if (!Array.isArray(globalList.sources) || globalList.counts?.events !== 2 || globalList.counts?.handoffs !== 1) {
    fail(`global list counts mismatch: ${JSON.stringify(globalList)}`);
  }

  const refusedPurge = jsonFail("purge requires yes", runCli(["purge"], workspace, env));
  if (!/purge requires --yes/i.test(refusedPurge.error)) fail(`purge refusal was misleading: ${refusedPurge.error}`);
  const purged = jsonOk("purge", runCli(["purge", "--yes"], workspace, env));
  if (purged.deleted?.events !== 2 || purged.deleted?.handoffs !== 1 || purged.deleted?.sessions !== 2)
    fail(`purge counts mismatch: ${JSON.stringify(purged)}`);
  const exportedAfterPurge = jsonOk("export after purge", runCli(["export"], workspace, env));
  if (exportedAfterPurge.events.length !== 0 || exportedAfterPurge.handoffs.length !== 0 || exportedAfterPurge.sessions.length !== 0) {
    fail(`purge left ledger rows: ${JSON.stringify(exportedAfterPurge)}`);
  }

  mkdirSync(dirname(evidencePath), { recursive: true });
  appendFileSync(
    evidencePath,
    [
      `\n[GREEN ${new Date().toISOString()}] node scripts/verify-cli-lifecycle.mjs PASS`,
      `temp_root=${tempRoot}`,
      "help_lists_core_ledger=true",
      "help_lists_removed_surfaces=false",
      `events_recorded=${exported.events.length}`,
      `handoffs_written=${exported.handoffs.length}`,
      "recent_recall_export_redacted=true",
      `global_scan_candidates=${scan.candidates.length}`,
      `global_migrate_events=${migrated.after.events}`,
      `global_list_events=${globalList.counts.events}`,
      "global_migrate_idempotent=true",
      "removed_cli_surfaces_absent_from_help=true",
      "purge_requires_confirmation=true",
      "purge_deleted_core_ledger=true",
      "adversarial=dirty_worktree:PASS,secret_redaction:PASS,idempotency_global_migrate:PASS,removed_surfaces_absent:PASS,purge_confirmation:PASS",
    ].join("\n"),
  );
  console.log("VERIFY PASS: core ledger CLI lifecycle");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
  console.log("CLEANUP: removed", tempRoot);
}
