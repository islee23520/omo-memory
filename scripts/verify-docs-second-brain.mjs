#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const cliPath = join(root, "dist", "cli.js");
const evidencePath = join(root, ".omo", "evidence", "omo-memory-second-brain-retention", "task-12-docs.txt");
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
  runCli(["session", "start", "--host", "codex", "--adapter", "lazycodex"], { cwd: projectDir, dbPath });
  runCli(["event", "record", "--type", "decision", "--summary", "Linaforge docs example uses global sqlite ontology"], { cwd: projectDir, dbPath });
  runCli(["event", "record", "--type", "qa_evidence", "--summary", "OpenTUI graph docs mention q quit and tab selection"], { cwd: projectDir, dbPath });
  return { projectDir, dbPath };
}

function main() {
  requireText("forget retention class", /`forget`/);
  requireText("temporary retention class", /`temporary`/);
  requireText("working retention class", /`working`/);
  requireText("durable retention class", /`durable`/);
  requireText("permanent retention class", /`permanent`/);
  requireText("global scan command", /global scan --root/);
  requireText("global migrate command", /global migrate --root/);
  requireText("ontology promote command", /ontology promote/);
  requireText("ontology demote command", /ontology demote/);
  requireText("ontology supersede command", /ontology supersede/);
  requireText("OpenTUI graph command", /graph tui/);
  requireText("graph q quit", /`q`: quit/);
  requireText("graph tab selection", /`Tab`: move to the next concept/);
  requireText("no raw transcript policy", /No full transcript capture by default/);
  requireText("copy import migration", /copy\/import only/);
  rejectText("bootstrap injection", /\bbootstrap\b[^.\n]*(injects|attaches|loads)[^.\n]*(memory|recent)/i);
  rejectText("automatic memory claim", /\ball memory is automatic\b/i);
  rejectText("cloud graph requirement", /\bgraph\b[^.\n]*(requires|needs)[^.\n]*(cloud|browser|web server)/i);
  rejectText("embedding requirement", /\bgraph\b[^.\n]*(requires|needs)[^.\n]*(embedding|vector)/i);

  const tempRoot = mkdtempSync(join(tmpdir(), "omo-docs-verify-"));
  try {
    const fixture = writeFixtureWorkspace(tempRoot);
    const globalDbPath = join(tempRoot, "global.sqlite");
    const scan = runCli(["global", "scan", "--root", tempRoot], { cwd: root, dbPath: fixture.dbPath });
    if (scan.candidates.length !== 1) fail(`doc scan expected one candidate: ${JSON.stringify(scan)}`);
    const migrate = runCli(["global", "migrate", "--root", tempRoot, "--global-db", globalDbPath], { cwd: root, dbPath: fixture.dbPath });
    if (migrate.after.events !== 2) fail(`doc migrate expected two events: ${JSON.stringify(migrate)}`);
    const candidates = runCli(["ontology", "candidates"], { cwd: root, dbPath: globalDbPath });
    if (candidates.concepts.length === 0) fail("doc ontology candidates produced no concepts");
    runCli(["ontology", "score"], { cwd: root, dbPath: globalDbPath });
    const promote = runCli(["ontology", "promote", "--concept", "linaforge", "--summary", "Docs promoted Linaforge memory"], {
      cwd: root,
      dbPath: globalDbPath,
    });
    const recall = runCli(["ontology", "recall", "--query", "linaforge"], { cwd: root, dbPath: globalDbPath });
    if (recall.durableMemories.length !== 1) fail(`doc recall expected one durable memory: ${JSON.stringify(recall)}`);
    runCli(["ontology", "demote", "--id", promote.durableMemory.id], { cwd: root, dbPath: globalDbPath });
    runCli(["ontology", "supersede", "--id", promote.durableMemory.id, "--summary", "Docs superseded Linaforge memory"], { cwd: root, dbPath: globalDbPath });
    const evidence = {
      docsChecked: Object.keys(docs),
      requiredText: "present",
      forbiddenClaims: "absent",
      commandExamples: [
        "global scan",
        "global migrate",
        "ontology candidates",
        "ontology score",
        "ontology promote",
        "ontology recall",
        "ontology demote",
        "ontology supersede",
      ],
      tempRoot,
      globalDbPath,
    };
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log("VERIFY PASS: second-brain docs and examples");
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
