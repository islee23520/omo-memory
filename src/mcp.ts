import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { initMemory, memoryPaths, recentEvents, recordEvent, resolveProjectContext, startSession, writeHandoff } from "./memory.js";

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({ name: "omo-memory", version: "0.1.0" });

  server.registerTool(
    "memory_init",
    {
      title: "Initialize OMO Memory",
      description: "Create or migrate the local OMO memory SQLite database.",
      inputSchema: {},
    },
    async () => jsonResult(initMemory()),
  );

  server.registerTool(
    "memory_project_context",
    {
      title: "Get OMO Project Context",
      description: "Return the current project identity used by OMO Memory.",
      inputSchema: {},
    },
    async () => jsonResult({ paths: memoryPaths(), project: resolveProjectContext() }),
  );

  server.registerTool(
    "memory_start_session",
    {
      title: "Start OMO Session",
      description: "Record a new OMO adapter session for the current project.",
      inputSchema: {
        host: z.enum(["codex", "opencode", "grok", "unknown"]),
        adapter: z.string().min(1),
      },
    },
    async ({ host, adapter }) => jsonResult(startSession({ host, adapter })),
  );

  server.registerTool(
    "memory_record_event",
    {
      title: "Record OMO Memory Event",
      description: "Append a summarized event to the current project's OMO memory ledger.",
      inputSchema: {
        type: z.string().min(1),
        summary: z.string().min(1),
        payloadJson: z.string().optional(),
        sessionId: z.string().optional(),
      },
    },
    async ({ type, summary, payloadJson, sessionId }) => jsonResult(recordEvent({ type, summary, ...(payloadJson === undefined ? {} : { payloadJson }), ...(sessionId === undefined ? {} : { sessionId }) })),
  );

  server.registerTool(
    "memory_recent_events",
    {
      title: "List Recent OMO Memory Events",
      description: "List recent events for the current project.",
      inputSchema: {
        limit: z.number().int().positive().max(100).default(10),
      },
    },
    async ({ limit }) => jsonResult({ events: recentEvents(limit) }),
  );

  server.registerTool(
    "memory_write_handoff",
    {
      title: "Write OMO Handoff",
      description: "Store a handoff summary for the current project.",
      inputSchema: {
        summaryMd: z.string().min(1),
        sessionId: z.string().optional(),
      },
    },
    async ({ summaryMd, sessionId }) => jsonResult(writeHandoff(summaryMd, sessionId)),
  );

  await server.connect(new StdioServerTransport());
}

function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
