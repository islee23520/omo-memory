#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const cliPath = join(root, "dist", "cli.js");
const evidencePath = join(root, ".omo", "evidence", "omo-memory-core-ledger", "task-12-docs.txt");
const docs = {
  readme: readFileSync(join(root, "README.md"), "utf8"),
  adapter: readFileSync(join(root, "docs", "adapter-integration.md"), "utf8"),
  epic: readFileSync(join(root, "docs", "epic-omo-memory.md"), "utf8"),
};

function fail(message) {
  throw new Error(`VERIFY FAIL: ${message}`);
}

function requireText(name, pattern) {
  const haystack = Object.values(docs).join("\n");
  if (!pattern.test(haystack)) fail(`${name} missing from docs`);
}

function rejectText(name, pattern) {
  const haystack = Object.values(docs).join("\n");
  if (pattern.test(haystack)) fail(`${name} forbidden claim found`);
}

function runCli(args, options) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd,
    env: { ...process.env, OMO_MEMORY_DB: options.dbPath },
    encoding: "utf8",
  });
  if (result.status !== 0) fail(`CLI ${args.join(" ")} failed: ${result.stdout}\n${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  if (parsed.ok !== true) fail(`CLI ${args.join(" ")} returned ok!=true: ${result.stdout}`);
  return parsed;
}

function writeFixtureWorkspace(tempRoot) {
  const projectDir = join(tempRoot, "fixture-project");
  const dbPath = join(projectDir, ".omo", "memory", "state.sqlite");
  mkdirSync(projectDir, { recursive: true });
  runCli(["init"], { cwd: projectDir, dbPath });
  const session = runCli(["session", "start", "--host", "codex", "--adapter", "docs-core-ledger"], { cwd: projectDir, dbPath });
  runCli(["event", "record", "--type", "decision", "--summary", "Docs example records a local core ledger event", "--session-id", session.sessionId], {
    cwd: projectDir,
    dbPath,
  });
  runCli(
    ["event", "record", "--type", "qa_evidence", "--summary", "Docs example imports local ledgers into global sqlite", "--session-id", session.sessionId],
    {
      cwd: projectDir,
      dbPath,
    },
  );
  runCli(["handoff", "write", "--summary", "Docs example writes an explicit handoff", "--session-id", session.sessionId], { cwd: projectDir, dbPath });
  return { projectDir, dbPath };
}

function main() {
  requireText("init command", /omo-memory init/);
  requireText("doctor command", /omo-memory doctor/);
  requireText("session start command", /session start --host/);
  requireText("event record command", /event record --type/);
  requireText("recent command", /omo-memory recent|\brecent \[--limit/);
  requireText("recall command", /recall --query/);
  requireText("handoff write command", /handoff write/);
  requireText("export command", /omo-memory export/);
  requireText("purge command", /purge --yes/);
  requireText("global scan command", /global scan --root/);
  requireText("global migrate command", /global migrate --root/);
  requireText("global list command", /global list --global-db/);
  requireText("MCP record event tool", /memory_record_event/);
  requireText("MCP recall events tool", /memory_recall_events/);
  requireText("MCP global scan tool", /memory_global_scan/);
  requireText("MCP global migrate tool", /memory_global_migrate/);
  requireText("MCP global list tool", /memory_global_list/);
  requireText("no raw transcript policy", /No full transcript capture by default/);
  requireText("copy import migration", /copy\/import only/);
  requireText("removed MCP ontology tools documented absent", /memory_ontology_\*` MCP tools are absent/);
  requireText("removed ontology CLI documented unknown", /omo-memory ontology \.\.\.` CLI commands are unknown/);
  requireText("removed graph CLI documented unknown", /omo-memory graph tui` is unknown/);
  rejectText("legacy shipped memory lifecycle", /ships automatic .*knowledge graph/i);
  rejectText("ontology shipped command example", /omo-memory ontology (candidates|extract|score|recompute|promote|demote|supersede|recall)/i);
  rejectText("graph keyboard docs", /`q`: quit|`Tab`: move to the next concept/);
  rejectText("bootstrap injection", /\bbootstrap\b[^.\n]*(injects|attaches|loads)[^.\n]*(memory|recent)/i);
  rejectText("automatic memory claim", /\ball memory is automatic\b/i);
  rejectText("cloud graph requirement", /\bgraph\b[^.\n]*(requires|needs)[^.\n]*(cloud|browser|web server)/i);
  rejectText("embedding requirement", /\b(recall|memory|graph)\b[^.\n]*(requires|needs)[^.\n]*(embedding|vector)/i);

  const tempRoot = mkdtempSync(join(tmpdir(), "omo-docs-verify-"));
  try {
    const fixture = writeFixtureWorkspace(tempRoot);
    const globalDbPath = join(tempRoot, "global.sqlite");
    const recent = runCli(["recent", "--limit", "5"], { cwd: fixture.projectDir, dbPath: fixture.dbPath });
    if (recent.events.length !== 2) fail(`doc recent expected two events: ${JSON.stringify(recent)}`);
    const recall = runCli(["recall", "--query", "global sqlite", "--limit", "5"], { cwd: fixture.projectDir, dbPath: fixture.dbPath });
    if (recall.events.length !== 1) fail(`doc recall expected one event: ${JSON.stringify(recall)}`);
    const exported = runCli(["export"], { cwd: fixture.projectDir, dbPath: fixture.dbPath });
    if (exported.events.length !== 2 || exported.handoffs.length !== 1) fail(`doc export expected ledger rows: ${JSON.stringify(exported)}`);
    const scan = runCli(["global", "scan", "--root", tempRoot], { cwd: root, dbPath: fixture.dbPath });
    if (scan.candidates.length !== 1) fail(`doc scan expected one candidate: ${JSON.stringify(scan)}`);
    const migrate = runCli(["global", "migrate", "--root", tempRoot, "--global-db", globalDbPath], { cwd: root, dbPath: fixture.dbPath });
    if (migrate.after.events !== 2 || migrate.after.handoffs !== 1) fail(`doc migrate expected ledger rows: ${JSON.stringify(migrate)}`);
    const globalList = runCli(["global", "list", "--global-db", globalDbPath], { cwd: root, dbPath: fixture.dbPath });
    if (globalList.counts.events !== 2 || globalList.counts.handoffs !== 1 || globalList.sources.length !== 1) {
      fail(`doc global list expected migrated ledger rows: ${JSON.stringify(globalList)}`);
    }
    const evidence = {
      docsChecked: Object.keys(docs),
      requiredText: "core ledger docs present",
      forbiddenClaims: "legacy ontology graph docs absent",
      commandExamples: ["init", "session start", "event record", "recent", "recall", "handoff write", "export", "global scan", "global migrate", "global list"],
      removedSurfacesAbsentFromDocs: ["ontology commands", "graph tui", "memory_ontology_*"],
      tempRoot,
      globalDbPath,
    };
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log("VERIFY PASS: core ledger docs and examples");
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
