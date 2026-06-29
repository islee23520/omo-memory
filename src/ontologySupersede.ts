import { randomUUID } from "node:crypto";
import { migrate, openMemoryDb } from "./memoryDb.js";
import { redactSecrets } from "./privacy.js";
import type { ProjectContext } from "./types.js";

export type SupersedeResult = {
  readonly originalId: string;
  readonly supersedingId: string;
};

type OriginalDurableRow = {
  readonly id: string;
  readonly type: string;
  readonly summary: string;
  readonly body: string | null;
  readonly sourceEventId: string | null;
  readonly sourceHandoffId: string | null;
  readonly confidence: number;
  readonly retentionClass: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function parseOriginal(value: unknown): OriginalDurableRow {
  if (!isRecord(value)) throw new Error("original durable not found");
  const id = String(value["id"] ?? "");
  if (id.length === 0) throw new Error("original durable not found");
  return {
    id,
    type: String(value["type"]),
    summary: String(value["summary"]),
    body: value["body"] == null ? null : String(value["body"]),
    sourceEventId: value["source_event_id"] == null ? null : String(value["source_event_id"]),
    sourceHandoffId: value["source_handoff_id"] == null ? null : String(value["source_handoff_id"]),
    confidence: Number(value["confidence"] ?? 0),
    retentionClass: value["retention_class"] == null ? null : String(value["retention_class"]),
  };
}

export function supersedeDurableMemory(
  dbPath: string,
  project: ProjectContext,
  originalId: string,
  opts: { readonly reason?: string; readonly newSummary?: string } = {},
): SupersedeResult {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const original = parseOriginal(
      db
        .prepare(
          "SELECT id, type, summary, body, source_event_id, source_handoff_id, confidence, retention_class FROM durable_memories WHERE id = ? AND project_id = ?",
        )
        .get(originalId, project.id),
    );
    const now = new Date().toISOString();
    db.prepare("UPDATE durable_memories SET status = 'superseded', valid_to = ?, updated_at = ? WHERE id = ? AND project_id = ?").run(
      now,
      now,
      originalId,
      project.id,
    );
    const newId = randomUUID();
    db.prepare(`
      INSERT INTO durable_memories (
        id, project_id, type, summary, body, source_event_id, source_handoff_id,
        confidence, status, retention_class, valid_from, valid_to, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId,
      project.id,
      original.type,
      opts.newSummary ? redactSecrets(opts.newSummary) : redactSecrets(original.summary),
      original.body == null ? null : redactSecrets(original.body),
      original.sourceEventId,
      original.sourceHandoffId,
      original.confidence,
      "active",
      original.retentionClass ?? "durable",
      null,
      null,
      now,
      now,
    );
    db.prepare(`
      INSERT INTO memory_references (id, project_id, source_type, source_id, target_type, target_id, ref_kind, weight, created_at)
      VALUES (?, ?, 'durable_memory', ?, 'durable_memory', ?, 'supersedes', 1, ?)
    `).run(randomUUID(), project.id, originalId, newId, now);
    return { originalId, supersedingId: newId };
  } finally {
    db.close();
  }
}
