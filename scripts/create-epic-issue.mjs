#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ownerRepo = process.env.OMO_MEMORY_REPO ?? "islee23520/omo-memory";
const body = readFileSync(join(root, "docs", "epic-omo-memory.md"), "utf8");

const args = [
  "issue",
  "create",
  "--repo",
  ownerRepo,
  "--title",
  "Epic: OMO Memory shared local session DB (CLI + MCP)",
  "--body",
  body,
  "--label",
  "epic",
  "--label",
  "mcp",
  "--label",
  "cli",
  "--label",
  "privacy",
];

const result = spawnSync("gh", args, { stdio: "inherit" });
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
