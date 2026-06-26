import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  CODEX_AGENTS_BLOCK,
  CODEX_HOOKS_JSON,
  CODEX_MARKETPLACE,
  CODEX_PLUGIN,
  CODEX_PLUGIN_JSON,
  CODEX_SKILL,
  GROK_AGENTS_BLOCK,
  GROK_HOOK_SCRIPT,
  GROK_HOOKS_JSON,
  GROK_MCP_JSON,
  GROK_PLUGIN_JSON,
  GROK_SKILL,
  SESSION_BOOTSTRAP_SCRIPT,
} from "./hookTemplates.js";

export type HookInstallHost = "codex" | "grok" | "all";

type HostTarget = "codex" | "grok";

type InstalledHost = {
  readonly host: HostTarget;
  readonly files: readonly string[];
  readonly notes: readonly string[];
};

type MarketplacePlugin = {
  readonly name: string;
  readonly source: {
    readonly source: "local";
    readonly path: string;
  };
  readonly policy?: {
    readonly installation: "AVAILABLE";
    readonly authentication: "ON_INSTALL";
  };
  readonly category?: string;
};

type Marketplace = {
  readonly name: string;
  readonly interface?: {
    readonly displayName: string;
  };
  readonly plugins: readonly MarketplacePlugin[];
};

export type HookInstallResult = {
  readonly home: string;
  readonly installed: readonly InstalledHost[];
};

const BLOCK_START = "<!-- omo-memory:start -->";
const BLOCK_END = "<!-- omo-memory:end -->";

export function installHooks(input: { readonly host: HookInstallHost }): HookInstallResult {
  const home = process.env["OMO_MEMORY_INSTALL_HOME"] ?? homedir();
  return { home, installed: targetsFor(input.host).map((target) => installTarget(target, home)) };
}

function targetsFor(host: HookInstallHost): readonly HostTarget[] {
  if (host === "all") return ["codex", "grok"];
  return [host];
}

function installTarget(host: HostTarget, home: string): InstalledHost {
  if (host === "codex") return installCodex(home);
  return installGrok(home);
}

function installCodex(home: string): InstalledHost {
  const skillPath = join(home, ".codex", "skills", "omo-memory", "SKILL.md");
  const agentsPath = join(home, ".codex", "AGENTS.md");
  const marketplacePath = join(home, ".codex", "local-marketplaces", CODEX_MARKETPLACE);
  const marketplaceJsonPath = join(marketplacePath, "marketplace.json");
  const agentsMarketplaceJsonPath = join(marketplacePath, ".agents", "plugins", "marketplace.json");
  const pluginRoot = join(marketplacePath, "plugins", CODEX_PLUGIN);
  const pluginJsonPath = join(pluginRoot, ".codex-plugin", "plugin.json");
  const pluginSkillPath = join(pluginRoot, "skills", "omo-memory", "SKILL.md");
  const hookJsonPath = join(pluginRoot, "hooks", "hooks.json");
  const hookScriptPath = join(pluginRoot, "scripts", "omo-memory-session.mjs");
  const configPath = join(home, ".codex", "config.toml");
  writeText(skillPath, CODEX_SKILL);
  upsertAgentsBlock(agentsPath, CODEX_AGENTS_BLOCK);
  writeText(pluginJsonPath, CODEX_PLUGIN_JSON);
  writeText(pluginSkillPath, CODEX_SKILL);
  writeText(hookJsonPath, CODEX_HOOKS_JSON);
  writeText(hookScriptPath, SESSION_BOOTSTRAP_SCRIPT);
  chmodSync(hookScriptPath, 0o755);
  upsertMarketplace(marketplaceJsonPath, { withInterface: false });
  upsertMarketplace(agentsMarketplaceJsonPath, { withInterface: true });
  upsertCodexConfig(configPath, marketplacePath);
  const pluginAddNote = maybeInstallCodexPlugin(home);
  return {
    host: "codex",
    files: [skillPath, agentsPath, pluginJsonPath, pluginSkillPath, hookJsonPath, hookScriptPath, marketplaceJsonPath, agentsMarketplaceJsonPath, configPath],
    notes: [
      "Codex MCP still needs `codex mcp add omo-memory -- npx -y omo-memory mcp` if it is not already present.",
      "Codex plugin hooks are installed through the local islee23520 marketplace and enabled in ~/.codex/config.toml.",
      pluginAddNote,
      "Codex may ask to trust the new hook command on first execution unless hook trust has already been granted.",
    ],
  };
}

function installGrok(home: string): InstalledHost {
  const skillPath = join(home, ".grok", "skills", "omo-memory", "SKILL.md");
  const agentsPath = join(home, ".grok", "AGENTS.md");
  const hookScriptPath = join(home, ".grok", "hooks", "omo-memory-session.mjs");
  const hookJsonPath = join(home, ".grok", "hooks", "omo-memory-hooks.json");
  const pluginRoot = join(home, ".grok", "plugins", "omo-memory");
  const pluginJsonPath = join(pluginRoot, "plugin.json");
  const pluginSkillPath = join(pluginRoot, "skills", "omo-memory", "SKILL.md");
  const pluginHookJsonPath = join(pluginRoot, "hooks", "hooks.json");
  const pluginHookScriptPath = join(pluginRoot, "scripts", "omo-memory-session.mjs");
  const pluginMcpPath = join(pluginRoot, ".mcp.json");
  writeText(skillPath, GROK_SKILL);
  upsertAgentsBlock(agentsPath, GROK_AGENTS_BLOCK);
  writeText(hookScriptPath, GROK_HOOK_SCRIPT);
  chmodSync(hookScriptPath, 0o755);
  writeText(hookJsonPath, GROK_HOOKS_JSON.replace("{{HOME}}", home));
  writeText(pluginJsonPath, GROK_PLUGIN_JSON);
  writeText(pluginSkillPath, GROK_SKILL);
  writeText(pluginHookJsonPath, GROK_HOOKS_JSON.replace(`node \\"{{HOME}}/.grok/hooks/omo-memory-session.mjs\\"`, `node \\"${pluginHookScriptPath}\\"`));
  writeText(pluginHookScriptPath, GROK_HOOK_SCRIPT);
  chmodSync(pluginHookScriptPath, 0o755);
  writeText(pluginMcpPath, GROK_MCP_JSON);
  const pluginInstallNote = maybeInstallGrokPlugin(home, pluginRoot);
  return {
    host: "grok",
    files: [skillPath, agentsPath, hookScriptPath, hookJsonPath, pluginJsonPath, pluginSkillPath, pluginHookJsonPath, pluginHookScriptPath, pluginMcpPath],
    notes: ["Grok plugin bundle installed at ~/.grok/plugins/omo-memory.", pluginInstallNote],
  };
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

function upsertMarketplace(path: string, input: { readonly withInterface: boolean }): void {
  const marketplace = readMarketplace(path, input.withInterface);
  const plugins = marketplace.plugins.filter((plugin) => plugin.name !== CODEX_PLUGIN);
  const omoMemory = marketplacePlugin(input.withInterface);
  const next = { ...marketplace, plugins: [...plugins, omoMemory] } satisfies Marketplace;
  writeText(path, `${JSON.stringify(next, null, 2)}\n`);
}

function readMarketplace(path: string, withInterface: boolean): Marketplace {
  if (!existsSync(path)) return defaultMarketplace(withInterface);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isMarketplace(parsed)) return defaultMarketplace(withInterface);
  return parsed;
}

function defaultMarketplace(withInterface: boolean): Marketplace {
  return {
    name: CODEX_MARKETPLACE,
    ...(withInterface ? { interface: { displayName: CODEX_MARKETPLACE } } : {}),
    plugins: [],
  };
}

function marketplacePlugin(withPolicy: boolean): MarketplacePlugin {
  return {
    name: CODEX_PLUGIN,
    source: { source: "local", path: "./plugins/omo-memory" },
    ...(withPolicy ? { policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Developer Tools" } : {}),
  };
}

function isMarketplace(value: unknown): value is Marketplace {
  if (!isRecord(value) || value["name"] !== CODEX_MARKETPLACE || !Array.isArray(value["plugins"])) return false;
  return value["plugins"].every(isMarketplacePlugin);
}

function isMarketplacePlugin(value: unknown): value is MarketplacePlugin {
  if (!isRecord(value) || typeof value["name"] !== "string" || !isRecord(value["source"])) return false;
  const source = value["source"];
  return source["source"] === "local" && typeof source["path"] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function upsertCodexConfig(path: string, marketplacePath: string): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const withHooks = ensureTomlKey(existing, "[features]", "plugin_hooks = true");
  const withMarketplace = ensureTomlTable(
    withHooks,
    `[marketplaces.${CODEX_MARKETPLACE}]`,
    `source_type = "local"\nsource = "${escapeTomlString(marketplacePath)}"`,
  );
  writeText(path, ensureTomlTable(withMarketplace, `[plugins."${CODEX_PLUGIN}@${CODEX_MARKETPLACE}"]`, "enabled = true"));
}

function maybeInstallCodexPlugin(home: string): string {
  if (home !== homedir()) return "Skipped `codex plugin add` because OMO_MEMORY_INSTALL_HOME points at a test/alternate home.";
  const result = spawnSync("codex", ["plugin", "add", `${CODEX_PLUGIN}@${CODEX_MARKETPLACE}`, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
  });
  if (result.status === 0) return "`codex plugin add omo-memory@islee23520 --json` completed successfully.";
  const detail = result.error instanceof Error ? result.error.message : result.stderr.trim();
  return `Could not run \`codex plugin add omo-memory@islee23520 --json\`: ${detail || "unknown error"}. Run it manually if Codex still reports the plugin as not installed.`;
}

function maybeInstallGrokPlugin(home: string, pluginRoot: string): string {
  if (home !== homedir()) return "Skipped `grok plugin install` because OMO_MEMORY_INSTALL_HOME points at a test/alternate home.";
  const result = spawnSync("grok", ["plugin", "install", pluginRoot, "--trust"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
  });
  if (result.status === 0) return "`grok plugin install ~/.grok/plugins/omo-memory --trust` completed successfully.";
  const detail = result.error instanceof Error ? result.error.message : result.stderr.trim();
  return `Could not run \`grok plugin install ~/.grok/plugins/omo-memory --trust\`: ${detail || "unknown error"}. Run it manually if Grok still reports the plugin as not installed.`;
}

function ensureTomlKey(text: string, table: string, keyValue: string): string {
  if (text.includes(keyValue)) return text;
  if (!text.includes(table)) return appendTomlTable(text, table, keyValue);
  const start = text.indexOf(table);
  const nextTable = text.indexOf("\n[", start + table.length);
  const insertAt = nextTable === -1 ? text.length : nextTable;
  return `${text.slice(0, insertAt).trimEnd()}\n${keyValue}\n${text.slice(insertAt).trimStart()}`;
}

function ensureTomlTable(text: string, table: string, body: string): string {
  if (text.includes(table)) return text;
  return appendTomlTable(text, table, body);
}

function appendTomlTable(text: string, table: string, body: string): string {
  const prefix = text.trimEnd();
  const separator = prefix.length === 0 ? "" : "\n\n";
  return `${prefix}${separator}${table}\n${body}\n`;
}

function escapeTomlString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function upsertAgentsBlock(path: string, block: string): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const wrapped = `${BLOCK_START}\n${block}\n${BLOCK_END}`;
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);
  if (start !== -1 && end > start) {
    writeText(path, `${existing.slice(0, start)}${wrapped}${existing.slice(end + BLOCK_END.length)}`);
    return;
  }
  const separator = existing.trim().length === 0 ? "" : "\n\n";
  writeText(path, `${existing.trimEnd()}${separator}${wrapped}\n`);
}
