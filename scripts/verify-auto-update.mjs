#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tempRoot = mkdtempSync(join(tmpdir(), "omo-auto-update-"));
const markerPath = join(tempRoot, "npm-calls.jsonl");
const statePath = join(tempRoot, "auto-update.json");
const dbPath = join(tempRoot, "state.sqlite");
const fakeNpm = join(tempRoot, "npm");

function fail(message) {
  throw new Error(`VERIFY FAIL: ${message}`);
}

function runCli(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [join(root, "dist", "cli.js"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      OMO_MEMORY_DB: dbPath,
      OMO_MEMORY_NPM_COMMAND: fakeNpm,
      OMO_MEMORY_UPDATE_STATE: statePath,
      OMO_MEMORY_UPDATE_TARGET: "omo-memory@verify",
      ...extraEnv,
    },
  });
  if (result.error) throw result.error;
  return result;
}

async function waitForCalls(count) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (readCalls().length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  fail(`expected ${count} fake npm calls, got ${readCalls().length}`);
}

function readCalls() {
  try {
    return readFileSync(markerPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

try {
  writeFileSync(
    fakeNpm,
    [
      "#!/usr/bin/env node",
      "const { appendFileSync } = require('node:fs');",
      `appendFileSync(${JSON.stringify(markerPath)}, JSON.stringify({ args: process.argv.slice(2), child: process.env.OMO_MEMORY_AUTO_UPDATE_CHILD, version: process.env.OMO_MEMORY_CURRENT_VERSION }) + '\\n');`,
      "process.stdout.write('fake npm ok\\n');",
    ].join("\n"),
  );
  chmodSync(fakeNpm, 0o755);

  const first = runCli(["doctor"]);
  if (first.status !== 0) fail(`doctor failed: ${first.stderr || first.stdout}`);
  await waitForCalls(1);
  const second = runCli(["doctor"]);
  if (second.status !== 0) fail(`second doctor failed: ${second.stderr || second.stdout}`);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const calls = readCalls();
  if (calls.length !== 1) fail(`automatic updater ran ${calls.length} times instead of once`);
  if (JSON.stringify(calls[0].args) !== JSON.stringify(["install", "-g", "omo-memory@verify"]))
    fail(`unexpected auto update args: ${JSON.stringify(calls[0])}`);
  if (calls[0].child !== "1") fail("auto update child guard env missing");

  const manual = runCli(["update"], { OMO_MEMORY_AUTO_UPDATE: "0" });
  if (manual.status !== 0) fail(`manual update command failed: ${manual.stderr || manual.stdout}`);
  const parsed = JSON.parse(manual.stdout);
  if (parsed.ok !== true || parsed.packageName !== "omo-memory" || parsed.command.at(-1) !== "omo-memory@verify") {
    fail(`manual update returned unexpected JSON: ${manual.stdout}`);
  }

  console.log("VERIFY PASS: automatic update is throttled, backgrounded, and manually invokable");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
