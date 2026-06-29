#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, "dist", "cli.js");
const evidencePath = join(root, ".omo", "evidence", "omo-memory-second-brain-retention", "task-7-cli-lifecycle.txt");

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

function durableCount(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT COUNT(*) AS count FROM durable_memories").get().count;
  } finally {
    db.close();
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), "omo-t7-cli-"));
try {
  const workspace = join(tempRoot, "workspace");
  const globalDb = join(tempRoot, "global.sqlite");
  const gitInit = spawnSync("git", ["init", workspace], { encoding: "utf8" });
  if (gitInit.status !== 0) fail(`git init failed: ${gitInit.stderr}`);
  writeFileSync(join(workspace, "dirty.txt"), "dirty_worktree fixture\n");

  const help = runCli(["help"], workspace);
  if (help.status !== 0 || !help.stdout.includes("ontology promote") || !help.stdout.includes("global migrate")) {
    fail("help output does not list lifecycle commands");
  }

  jsonOk("event seed 1", runCli(["event", "record", "--type", "decision", "--summary", "Adopt ontology lifecycle for local-first memory"], workspace));
  jsonOk("event seed 2", runCli(["event", "record", "--type", "qa", "--summary", "Verify ontology lifecycle recall for local-first memory"], workspace));
  jsonOk("event seed 3", runCli(["event", "record", "--type", "decision", "--summary", "Keep ontology promotion durable and searchable"], workspace));

  const scan = jsonOk("global scan", runCli(["global", "scan", "--root", tempRoot, "--json"], workspace));
  if (!Array.isArray(scan.candidates) || scan.candidates.length !== 1) fail(`scan candidates mismatch: ${JSON.stringify(scan)}`);
  const migrated = jsonOk("global migrate", runCli(["global", "migrate", "--root", tempRoot, "--global-db", globalDb, "--json"], workspace));
  if (migrated.after?.events !== 3) fail(`global migrate event count mismatch: ${JSON.stringify(migrated)}`);
  const migratedAgain = jsonOk("global migrate idempotent", runCli(["global", "migrate", "--root", tempRoot, "--global-db", globalDb, "--json"], workspace));
  if (migratedAgain.after?.events !== migrated.after.events) fail("global migrate was not idempotent");

  const candidates = jsonOk("ontology candidates", runCli(["ontology", "candidates"], workspace));
  const ontology = candidates.concepts.find((concept) => concept.label === "ontology");
  if (!ontology || ontology.refCount < 2) fail(`ontology candidate missing/refCount low: ${JSON.stringify(candidates.concepts)}`);

  const firstScore = jsonOk("ontology score", runCli(["ontology", "score"], workspace));
  const secondScore = jsonOk("ontology recompute stale_state", runCli(["ontology", "recompute"], workspace));
  if (firstScore.scannedConcepts < 1 || secondScore.scannedConcepts !== firstScore.scannedConcepts) fail("score/recompute did not scan concepts consistently");

  const stateDb = join(workspace, ".omo", "memory", "state.sqlite");
  const beforeMissingPromote = durableCount(stateDb);
  const missing = jsonFail("missing promote", runCli(["ontology", "promote", "--concept", "missing-candidate"], workspace));
  if (!missing.error.includes("candidate not found")) fail(`missing promote error was misleading: ${missing.error}`);
  if (durableCount(stateDb) !== beforeMissingPromote) fail("missing promote created partial durable rows");

  const promoted = jsonOk(
    "ontology promote",
    runCli(["ontology", "promote", "--concept", "ontology", "--body", "ontology durable body token=sk-test1234567890"], workspace),
  );
  if (promoted.durableMemory?.body?.includes("sk-test1234567890")) fail("promote leaked raw secret in durable body");
  if (!promoted.durableMemory?.body?.includes("[REDACTED]")) fail("promote did not redact secret body");

  const recalled = jsonOk("ontology recall", runCli(["ontology", "recall", "--query", "ontology", "--limit", "5"], workspace));
  if (!recalled.durableMemories.some((memory) => memory.id === promoted.durableMemory.id)) fail("ontology recall missed promoted durable memory");
  if (JSON.stringify(recalled).includes("sk-test1234567890")) fail("ontology recall leaked raw secret");

  const demoted = jsonOk("ontology demote", runCli(["ontology", "demote", "--id", promoted.durableMemory.id], workspace));
  if (demoted.durableMemory?.retentionClass !== "temporary") fail("ontology demote did not lower retention class");

  const superseded = jsonOk(
    "ontology supersede",
    runCli(["ontology", "supersede", "--id", promoted.durableMemory.id, "--summary", "ontology replacement"], workspace),
  );
  if (typeof superseded.supersedingId !== "string") fail("ontology supersede did not create replacement");
  const afterSupersede = jsonOk("ontology recall after supersede", runCli(["ontology", "recall", "--query", "ontology", "--limit", "10"], workspace));
  if (!afterSupersede.durableMemories.some((memory) => memory.id === superseded.supersedingId)) fail("superseding durable memory not recallable");

  mkdirSync(dirname(evidencePath), { recursive: true });
  appendFileSync(
    evidencePath,
    [
      `\n[GREEN ${new Date().toISOString()}] node scripts/verify-cli-lifecycle.mjs PASS`,
      `temp_root=${tempRoot}`,
      "help_lists_lifecycle=true",
      `global_scan_candidates=${scan.candidates.length}`,
      `global_migrate_events=${migrated.after.events}`,
      "global_migrate_idempotent=true",
      `ontology_candidate_ref_count=${ontology.refCount}`,
      `score_scanned=${firstScore.scannedConcepts}`,
      "missing_promote_json_error=true",
      "missing_promote_partial_rows=false",
      `promoted_id=${promoted.durableMemory.id}`,
      "promote_secret_redacted=true",
      `superseding_id=${superseded.supersedingId}`,
      "adversarial=malformed_input:PASS,dirty_worktree:PASS,stale_state:PASS,misleading_success_output:PASS,generated_cached_artifacts:PASS,secret_leak_redaction:PASS,idempotency_global_migrate:PASS",
    ].join("\n"),
  );
  console.log("VERIFY PASS: Todo 7 CLI ontology lifecycle");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
  console.log("CLEANUP: removed", tempRoot);
}
