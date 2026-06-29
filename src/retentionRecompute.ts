import type Database from "better-sqlite3";
import { migrate, openMemoryDb } from "./memoryDb.js";
import { classifyRetention, computeRetentionScore } from "./retentionPolicy.js";

type RecomputeOptions = {
  readonly dbPath: string;
  readonly nowIso: string;
};

export type RetentionRecomputeResult = {
  readonly scannedConcepts: number;
  readonly updatedConcepts: number;
  readonly skippedPermanentConcepts: number;
  readonly nowIso: string;
};

type ConceptRow = {
  readonly id: string;
  readonly label: string;
  readonly payloadJson: string;
  readonly score: number;
  readonly retentionClass: string;
  readonly manualPin: number;
  readonly refCount: number;
  readonly projectSpread: number;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
};

type SignalRow = {
  readonly label: string;
  readonly frequency: number;
  readonly projectSpread: number;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly decisionWeight: number;
  readonly qaWeight: number;
  readonly contradictionCount: number;
};

type RelationRow = {
  readonly conceptId: string;
  readonly relationDegree: number;
};

type ReferenceCountRow = {
  readonly conceptId: string;
  readonly refCount: number;
};

type Signal = {
  readonly frequency: number;
  readonly projectSpread: number;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly decisionWeight: number;
  readonly qaWeight: number;
  readonly contradictionCount: number;
};

type ParsedPayload = {
  readonly confidence?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parsePayload(payloadJson: string): ParsedPayload {
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (!isRecord(parsed)) return {};
    const confidence = parsed["confidence"];
    if (typeof confidence === "number" && Number.isFinite(confidence)) {
      return { confidence: Math.max(0, Math.min(1, confidence)) };
    }
    return {};
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

function ageDays(nowIso: string, seenIso: string | null): number {
  if (seenIso == null) return 0;
  const nowMs = Date.parse(nowIso);
  const seenMs = Date.parse(seenIso);
  if (!Number.isFinite(nowMs) || !Number.isFinite(seenMs)) return 0;
  return Math.max(0, Math.floor((nowMs - seenMs) / 86_400_000));
}

function loadSignals(db: Database.Database): ReadonlyMap<string, Signal> {
  const rows = db
    .prepare(`
      SELECT
        c.label AS label,
        COALESCE(SUM(mr.weight), 0) AS frequency,
        COUNT(DISTINCT c.project_id) AS projectSpread,
        MIN(COALESCE(mr.created_at, c.first_seen, c.created_at)) AS firstSeen,
        MAX(COALESCE(mr.created_at, c.last_seen, c.updated_at)) AS lastSeen,
        COALESCE(SUM(CASE WHEN e.type IN ('decision', 'decide', 'decision_record') THEN mr.weight ELSE 0 END), 0) AS decisionWeight,
        COALESCE(SUM(CASE WHEN e.type IN ('qa', 'test', 'verification', 'evidence') THEN mr.weight ELSE 0 END), 0) AS qaWeight,
        COALESCE(SUM(CASE WHEN e.type IN ('contradiction', 'conflict', 'reversal') THEN 1 ELSE 0 END), 0) AS contradictionCount
      FROM concepts c
      LEFT JOIN memory_references mr ON mr.target_type = 'concept' AND mr.target_id = c.id
      LEFT JOIN events e ON mr.source_type = 'event' AND e.id = mr.source_id
      GROUP BY c.label
    `)
    .all() as readonly SignalRow[];
  return new Map(
    rows.map((row) => [
      row.label,
      {
        frequency: row.frequency,
        projectSpread: row.projectSpread,
        firstSeen: row.firstSeen,
        lastSeen: row.lastSeen,
        decisionWeight: row.decisionWeight,
        qaWeight: row.qaWeight,
        contradictionCount: row.contradictionCount,
      },
    ]),
  );
}

function loadReferenceCounts(db: Database.Database): ReadonlyMap<string, number> {
  const rows = db
    .prepare(`
      SELECT c.id AS conceptId, COUNT(mr.id) AS refCount
      FROM concepts c
      LEFT JOIN memory_references mr ON mr.target_type = 'concept' AND mr.target_id = c.id
      GROUP BY c.id
    `)
    .all() as readonly ReferenceCountRow[];
  return new Map(rows.map((row) => [row.conceptId, row.refCount]));
}

function loadRelationDegrees(db: Database.Database): ReadonlyMap<string, number> {
  const rows = db
    .prepare(`
      SELECT concept_id AS conceptId, COUNT(DISTINCT relation_id) AS relationDegree
      FROM (
        SELECT source_id AS concept_id, id AS relation_id FROM relations WHERE source_type = 'concept'
        UNION ALL
        SELECT target_id AS concept_id, id AS relation_id FROM relations WHERE target_type = 'concept'
      )
      GROUP BY concept_id
    `)
    .all() as readonly RelationRow[];
  return new Map(rows.map((row) => [row.conceptId, row.relationDegree]));
}

function updateConcept(db: Database.Database, row: ConceptRow, update: ConceptUpdate): boolean {
  if (
    row.score === update.score &&
    row.retentionClass === update.retentionClass &&
    row.refCount === update.refCount &&
    row.projectSpread === update.projectSpread &&
    row.firstSeen === update.firstSeen &&
    row.lastSeen === update.lastSeen
  ) {
    return false;
  }
  db.prepare(`
    UPDATE concepts
    SET score = ?, retention_class = ?, ref_count = ?, project_spread = ?,
      first_seen = ?, last_seen = ?, updated_at = ?
    WHERE id = ?
  `).run(update.score, update.retentionClass, update.refCount, update.projectSpread, update.firstSeen, update.lastSeen, update.nowIso, row.id);
  return true;
}

type ConceptUpdate = {
  readonly score: number;
  readonly retentionClass: string;
  readonly refCount: number;
  readonly projectSpread: number;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly nowIso: string;
};

export function recomputeRetentionScores(options: RecomputeOptions): RetentionRecomputeResult {
  const db = openMemoryDb(options.dbPath);
  try {
    migrate(db);
    const rows = db
      .prepare(`
        SELECT id, label, payload_json AS payloadJson, COALESCE(score, 0) AS score,
          COALESCE(retention_class, 'working') AS retentionClass, COALESCE(manual_pin, 0) AS manualPin,
          COALESCE(ref_count, 0) AS refCount, COALESCE(project_spread, 1) AS projectSpread,
          first_seen AS firstSeen, last_seen AS lastSeen
        FROM concepts
        ORDER BY id ASC
      `)
      .all() as readonly ConceptRow[];
    const signals = loadSignals(db);
    const referenceCounts = loadReferenceCounts(db);
    const relationDegrees = loadRelationDegrees(db);
    let updatedConcepts = 0;
    let skippedPermanentConcepts = 0;

    const recompute = db.transaction(() => {
      for (const row of rows) {
        if (row.manualPin === 1 || row.retentionClass === "permanent") {
          skippedPermanentConcepts += 1;
          continue;
        }
        const signal = signals.get(row.label) ?? {
          frequency: row.refCount,
          projectSpread: row.projectSpread,
          firstSeen: row.firstSeen,
          lastSeen: row.lastSeen,
          decisionWeight: 0,
          qaWeight: 0,
          contradictionCount: 0,
        };
        const score = computeRetentionScore({
          frequency: signal.frequency,
          recencyDays: ageDays(options.nowIso, signal.lastSeen),
          spread: signal.projectSpread,
          decisionWeight: signal.decisionWeight,
          qaWeight: signal.qaWeight,
          relationDegree: relationDegrees.get(row.id) ?? 0,
          confidence: parsePayload(row.payloadJson).confidence ?? 0,
          manualPin: false,
          ageDays: ageDays(options.nowIso, signal.firstSeen),
          contradictionCount: signal.contradictionCount,
        });
        const changed = updateConcept(db, row, {
          score,
          retentionClass: classifyRetention(score, false),
          refCount: referenceCounts.get(row.id) ?? row.refCount,
          projectSpread: signal.projectSpread,
          firstSeen: signal.firstSeen,
          lastSeen: signal.lastSeen,
          nowIso: options.nowIso,
        });
        if (changed) updatedConcepts += 1;
      }
    });
    recompute();
    return {
      scannedConcepts: rows.length,
      updatedConcepts,
      skippedPermanentConcepts,
      nowIso: options.nowIso,
    };
  } finally {
    db.close();
  }
}
