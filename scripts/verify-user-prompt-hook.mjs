#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, "dist", "cli.js");
const hook = join(root, "scripts", "omo-memory-user-prompt.mjs");

function fail(message) {
  console.error(`VERIFY FAIL: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function json(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

const tempRoot = mkdtempSync(join(tmpdir(), "omo-user-prompt-hook-"));
try {
  const dbPath = join(tempRoot, "memory.sqlite");
  const env = {
    ...process.env,
    OMO_MEMORY_DB: dbPath,
    OMO_MEMORY_CLI: cli,
    OMO_MEMORY_HOST: "codex",
    OMO_MEMORY_ADAPTER: "verify-hook",
  };

  json(cli, ["init"], { cwd: tempRoot, env });
  const prompt = "Remember that the user wants OMO Memory to observe UserPromptSubmit as the durable intent signal. token=github_pat_TESTSECRET123456789";
  const hookPayload = JSON.stringify({
    hookEventName: "UserPromptSubmit",
    sessionId: "host-session-1",
    workspaceRoot: tempRoot,
    prompt,
    assistantOutput: "This must not be saved.",
  });
  const hookResult = run("node", [hook], { cwd: tempRoot, env, input: hookPayload });
  if (hookResult.status !== 0) fail(`hook exited ${hookResult.status}: ${hookResult.stderr || hookResult.stdout}`);

  const recent = json(cli, ["recent", "--limit", "3"], { cwd: tempRoot, env });
  const event = recent.events.find((item) => item.type === "user_prompt");
  if (event === undefined) fail(`user_prompt event missing: ${JSON.stringify(recent)}`);
  if (!event.summary.includes("UserPromptSubmit")) fail(`prompt summary missing user intent: ${event.summary}`);
  if (event.summary.includes("This must not be saved")) fail(`assistant output leaked: ${event.summary}`);
  if (event.summary.includes("github_pat_TESTSECRET")) fail(`secret was not redacted: ${event.summary}`);
  console.log("VERIFY PASS (UserPromptSubmit hook records redacted user prompt only)");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
