import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyConceptExtraction, extractConceptCandidates } from "./conceptExtraction.js";
import { listGlobalMemory, migrateToGlobalMemory, scanForMemoryDbs } from "./globalMemory.js";
import { memoryPaths } from "./memoryReport.js";
import { createDurableMemory, listOntologyRows, supersedeDurableMemory, updateDurableRetention } from "./ontologyCore.js";
import { resolveProjectContext } from "./projectContext.js";
import { recomputeRetentionScores } from "./retentionRecompute.js";
import type { ConceptExportRow, DurableMemoryExportRow } from "./types.js";

const retentionClassSchema = z.enum(["forget", "temporary", "working", "durable", "permanent"]);
const nonBlankStringSchema = z.string().trim().min(1);

export function registerGlobalOntologyTools(server: McpServer): void {
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

  registerOntologyTools(server);
}

function registerOntologyTools(server: McpServer): void {
  server.registerTool(
    "memory_ontology_candidates",
    {
      title: "Extract OMO Ontology Candidates",
      description: "Return deterministic ontology candidate labels from a short event summary without writing rows.",
      inputSchema: { summary: nonBlankStringSchema, eventType: nonBlankStringSchema.optional() },
    },
    async ({ summary, eventType }) => jsonResult({ candidates: extractConceptCandidates(summary, eventType) }),
  );

  server.registerTool(
    "memory_ontology_extract",
    {
      title: "Write OMO Ontology Extraction",
      description: "Explicitly extract concepts from a short event summary and write event-to-concept references.",
      inputSchema: {
        sourceEventId: nonBlankStringSchema,
        summary: nonBlankStringSchema,
        eventType: nonBlankStringSchema.optional(),
      },
    },
    async ({ sourceEventId, summary, eventType }) =>
      jsonResult(applyConceptExtraction(memoryPaths().dbPath, resolveProjectContext(), sourceEventId, summary, eventType)),
  );

  server.registerTool(
    "memory_ontology_score",
    {
      title: "Recompute OMO Ontology Scores",
      description: "Explicitly recompute ontology retention scores for the local OMO memory SQLite database.",
      inputSchema: { nowIso: z.string().datetime().optional() },
    },
    async ({ nowIso }) => jsonResult(recomputeRetentionScores({ dbPath: memoryPaths().dbPath, nowIso: nowIso ?? new Date().toISOString() })),
  );

  server.registerTool(
    "memory_ontology_promote",
    {
      title: "Promote OMO Durable Memory",
      description: "Explicitly promote a summarized memory into durable ontology storage.",
      inputSchema: {
        type: nonBlankStringSchema,
        summary: nonBlankStringSchema,
        body: nonBlankStringSchema.optional(),
        sourceEventId: nonBlankStringSchema.optional(),
        sourceHandoffId: nonBlankStringSchema.optional(),
        confidence: z.number().min(0).max(1).optional(),
        status: nonBlankStringSchema.optional(),
        retentionClass: retentionClassSchema.optional(),
      },
    },
    async ({ type, summary, body, sourceEventId, sourceHandoffId, confidence, status, retentionClass }) =>
      jsonResult(
        createDurableMemory(memoryPaths().dbPath, resolveProjectContext(), {
          type,
          summary,
          ...(body === undefined ? {} : { body }),
          ...(sourceEventId === undefined ? {} : { sourceEventId }),
          ...(sourceHandoffId === undefined ? {} : { sourceHandoffId }),
          ...(confidence === undefined ? {} : { confidence }),
          ...(status === undefined ? {} : { status }),
          ...(retentionClass === undefined ? {} : { retentionClass }),
        }),
      ),
  );

  server.registerTool(
    "memory_ontology_demote",
    {
      title: "Demote OMO Durable Memory",
      description: "Explicitly change the retention class for a durable ontology memory.",
      inputSchema: { durableId: nonBlankStringSchema, retentionClass: retentionClassSchema.default("temporary") },
    },
    async ({ durableId, retentionClass }) => jsonResult(updateDurableRetention(memoryPaths().dbPath, resolveProjectContext(), durableId, { retentionClass })),
  );

  server.registerTool(
    "memory_ontology_supersede",
    {
      title: "Supersede OMO Durable Memory",
      description: "Explicitly mark a durable memory superseded and create a successor memory.",
      inputSchema: {
        durableId: nonBlankStringSchema,
        reason: nonBlankStringSchema.optional(),
        newSummary: nonBlankStringSchema.optional(),
      },
    },
    async ({ durableId, reason, newSummary }) =>
      jsonResult(
        supersedeDurableMemory(memoryPaths().dbPath, resolveProjectContext(), durableId, {
          ...(reason === undefined ? {} : { reason }),
          ...(newSummary === undefined ? {} : { newSummary }),
        }),
      ),
  );

  server.registerTool(
    "memory_ontology_recall",
    {
      title: "Recall OMO Ontology Rows",
      description: "Explicitly recall ontology concepts and durable memories matching a query.",
      inputSchema: { query: nonBlankStringSchema, limit: z.number().int().positive().max(100).default(10) },
    },
    async ({ query, limit }) => jsonResult(recallOntology(query, limit)),
  );
}

function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function recallOntology(
  query: string,
  limit: number,
): { readonly concepts: readonly ConceptExportRow[]; readonly durableMemories: readonly DurableMemoryExportRow[] } {
  const rows = listOntologyRows(memoryPaths().dbPath, resolveProjectContext());
  const normalizedQuery = query.toLowerCase();
  const queryTerms = normalizedQuery.split(/[^a-z0-9_-]+/).filter((term) => term.length >= 3);
  return {
    concepts: rows.concepts.filter((concept) => matchesConcept(concept, normalizedQuery, queryTerms)).slice(0, limit),
    durableMemories: rows.durableMemories.filter((memory) => matchesDurableMemory(memory, normalizedQuery, queryTerms)).slice(0, limit),
  };
}

function matchesConcept(concept: ConceptExportRow, normalizedQuery: string, queryTerms: readonly string[]): boolean {
  return matchesText([concept.label, concept.description ?? "", concept.aliasesJson], normalizedQuery, queryTerms);
}

function matchesDurableMemory(memory: DurableMemoryExportRow, normalizedQuery: string, queryTerms: readonly string[]): boolean {
  return matchesText([memory.type, memory.summary, memory.body ?? ""], normalizedQuery, queryTerms);
}

function matchesText(values: readonly string[], normalizedQuery: string, queryTerms: readonly string[]): boolean {
  const normalizedValues = values.map((value) => value.toLowerCase());
  if (normalizedValues.some((value) => value.includes(normalizedQuery))) return true;
  return queryTerms.length > 0 && queryTerms.every((term) => normalizedValues.some((value) => value.includes(term)));
}
