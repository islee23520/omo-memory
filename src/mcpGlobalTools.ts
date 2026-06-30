import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listGlobalMemory, migrateToGlobalMemory, scanForMemoryDbs } from "./globalMemory.js";

const nonBlankStringSchema = z.string().trim().min(1);

export function registerGlobalTools(server: McpServer): void {
  server.registerTool(
    "memory_global_scan",
    {
      title: "Scan Global OMO Memory Sources",
      description: "Explicitly scan a filesystem root for local OMO memory SQLite databases without importing them.",
      inputSchema: { rootPath: nonBlankStringSchema },
    },
    async ({ rootPath }) => jsonResult(scanForMemoryDbs(rootPath)),
  );

  server.registerTool(
    "memory_global_migrate",
    {
      title: "Migrate OMO Memory To Global SQLite",
      description: "Explicitly create or update a global OMO memory SQLite database from discovered local memory databases.",
      inputSchema: { rootPath: nonBlankStringSchema, globalDbPath: nonBlankStringSchema },
    },
    async ({ rootPath, globalDbPath }) => jsonResult(migrateToGlobalMemory({ rootPath, globalDbPath })),
  );

  server.registerTool(
    "memory_global_list",
    {
      title: "List Global OMO Memory",
      description: "List sources and counts from an explicit global OMO memory SQLite database.",
      inputSchema: { globalDbPath: nonBlankStringSchema },
    },
    async ({ globalDbPath }) => jsonResult(listGlobalMemory(globalDbPath)),
  );
}

function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
