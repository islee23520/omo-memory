export const CODEX_MARKETPLACE = "islee23520";
export const CODEX_PLUGIN = "omo-memory";

export const CODEX_SKILL = `---
name: omo-memory
description: Use OMO Memory for concise local project memory: bootstrap recent events, record decisions, QA evidence, blockers, and handoffs without secrets.
---

# OMO Memory

For non-trivial workspace work, call \`memory_bootstrap_session\` before edits:

- \`host\`: \`codex\`
- \`adapter\`: \`lazycodex\`
- \`limit\`: \`2\`

Read \`recentEvents\`, keep the returned \`sessionId\`, and record only durable summaries with \`memory_record_event\`: decisions, QA evidence, task state, blockers, and handoffs.

Use \`memory_write_handoff\` only for explicit handoff summaries. Never store transcripts, secrets, \`.env\`, auth files, cookies, bearer headers, or raw secret-bearing logs.
`;

export const GROK_SKILL = CODEX_SKILL.replace("Codex, Grok", "Grok, Codex")
  .replace("- `host`: `codex`", "- `host`: `grok`")
  .replace("- `adapter`: `lazycodex`", "- `adapter`: `lfg`");

export const CODEX_AGENTS_BLOCK = `### OMO Memory lifecycle

When the \`omo-memory\` MCP server is available, use it for concise local project memory. For non-trivial workspace work, call \`memory_bootstrap_session\` before edits:

- \`host\`: \`codex\`
- \`adapter\`: \`lazycodex\`
- \`limit\`: \`2\`

Read \`recentEvents\`, keep the returned \`sessionId\`, and record only durable summaries with \`memory_record_event\`: decisions, task state, QA evidence, blockers, and handoffs. Never store transcripts, secrets, \`.env\`, auth files, cookies, bearer headers, or raw secret-bearing logs.`;

export const GROK_AGENTS_BLOCK = CODEX_AGENTS_BLOCK.replace("- `host`: `codex`", "- `host`: `grok`").replace("- `adapter`: `lazycodex`", "- `adapter`: `lfg`");

export const SESSION_BOOTSTRAP_SCRIPT = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const host = process.env["OMO_MEMORY_HOST"] ?? "codex";
const adapter = process.env["OMO_MEMORY_ADAPTER"] ?? "lazycodex";
const limit = process.env["OMO_MEMORY_LIMIT"] ?? "2";
const args = ["session", "bootstrap", "--host", host, "--adapter", adapter, "--limit", limit];

const direct = process.env["OMO_MEMORY_CLI"] ?? "omo-memory";
const result = runBootstrap(direct, args) ?? runBootstrap("npx", ["-y", "omo-memory", ...args]);

if (result === undefined || result.status !== 0) {
  process.stdout.write("OMO Memory: bootstrap unavailable; continue without blocking the session.\\n");
  process.exit(0);
}

try {
  const payload = JSON.parse(result.stdout);
  const recentEvents = Array.isArray(payload.recentEvents) ? payload.recentEvents : [];
  process.stdout.write(\`OMO Memory sessionId: \${payload.sessionId}\\n\`);
  if (recentEvents.length === 0) {
    process.exit(0);
  }
  process.stdout.write("OMO Memory recentEvents:\\n");
  for (const event of recentEvents.slice(0, Number(limit))) {
    process.stdout.write(\`- \${event.type}: \${event.summary}\\n\`);
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stdout.write(\`OMO Memory: bootstrap returned unreadable output; \${detail}\\n\`);
}

function runBootstrap(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 2000
  });
  if (result.error && result.error.code === "ENOENT") return undefined;
  return result;
}
`;

export const GROK_HOOK_SCRIPT = SESSION_BOOTSTRAP_SCRIPT.replace('?? "codex"', '?? "grok"').replace('?? "lazycodex"', '?? "lfg"');

export const GROK_PLUGIN_JSON = `{
  "name": "omo-memory",
  "version": "0.1.9",
  "description": "Project-local OMO Memory bootstrap hook and MCP server for Grok.",
  "author": {
    "name": "islee23520"
  },
  "repository": "https://github.com/islee23520/omo-memory",
  "homepage": "https://github.com/islee23520/omo-memory",
  "license": "MIT",
  "keywords": ["grok", "hooks", "memory", "mcp"],
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json"
}
`;

export const GROK_MCP_JSON = `{
  "mcpServers": {
    "omo-memory": {
      "command": "npx",
      "args": ["-y", "omo-memory", "mcp"]
    }
  }
}
`;

export const CODEX_PLUGIN_JSON = `{
  "name": "omo-memory",
  "version": "0.1.9",
  "description": "Session-start OMO Memory bootstrap hook for Codex.",
  "author": "islee23520",
  "homepage": "https://github.com/islee23520/omo-memory",
  "repository": "https://github.com/islee23520/omo-memory",
  "license": "MIT",
  "keywords": ["codex", "hooks", "memory", "mcp"],
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "interface": {
    "displayName": "OMO Memory",
    "shortDescription": "Bootstraps local shared memory at Codex session start.",
    "longDescription": "OMO Memory records concise local session state and loads recent project memory through the omo-memory CLI and MCP server.",
    "developerName": "islee23520",
    "category": "Developer Tools",
    "capabilities": ["Hooks", "MCP Tools", "Workflow"],
    "websiteURL": "https://github.com/islee23520/omo-memory",
    "privacyPolicyURL": "https://github.com/islee23520/omo-memory#privacy",
    "termsOfServiceURL": "https://github.com/islee23520/omo-memory#license",
    "defaultPrompt": [
      "Use OMO Memory to load recent project memory before non-trivial workspace work.",
      "Record durable decisions, task state, QA evidence, blockers, and handoffs without storing secrets or full transcripts."
    ],
    "brandColor": "#0F766E",
    "screenshots": []
  },
  "capabilities": []
}
`;

export const CODEX_HOOKS_JSON = `{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \\"\${PLUGIN_ROOT}/scripts/omo-memory-session.mjs\\"",
            "timeout": 2,
            "description": "omo-memory session bootstrap",
            "statusMessage": "OMO Memory: loading recent session memory"
          }
        ]
      }
    ]
  }
}
`;

export const GROK_HOOKS_JSON = `{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \\"{{HOME}}/.grok/hooks/omo-memory-session.mjs\\"",
            "timeout": 2,
            "description": "omo-memory session bootstrap",
            "statusMessage": "OMO Memory: loading recent session memory"
          }
        ]
      }
    ]
  }
}
`;
