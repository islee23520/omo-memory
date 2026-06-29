import { recordMemoryReference, upsertConcept } from "./ontologyCore.js";
import { redactSecrets } from "./privacy.js";
import type { ConceptExportRow, MemoryReferenceExportRow, ProjectContext } from "./types.js";

// Comprehensive generic/hook stopwords. Keep domain terms out.
const STOPWORDS = new Set<string>([
  // from recall + hook words
  "action",
  "asked",
  "current",
  "help",
  "memory",
  "need",
  "needs",
  "omo",
  "please",
  "prompt",
  "request",
  "requested",
  "session",
  "user",
  "want",
  "wants",
  "work",
  "working",
  // common English + dev noise
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "about",
  "this",
  "that",
  "these",
  "those",
  "start",
  "now",
  "test",
  "run",
  "check",
  "fix",
  "add",
  "change",
  "update",
  "get",
  "set",
  "make",
  "create",
  "delete",
  "remove",
  "show",
  "list",
  "use",
  "using",
  "via",
  "task",
  "todo",
  "step",
  "item",
  "thing",
  "stuff",
  "new",
  "old",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "please",
  "thanks",
  "thank",
  "also",
  "just",
  "only",
  "like",
  "such",
  "very",
  "really",
  "should",
  "could",
  "would",
  "will",
  "can",
  "may",
  "must",
  "have",
  "has",
  "had",
  "been",
  "being",
  "are",
  "was",
  "were",
  "is",
  "be",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "as",
  "it",
  "its",
  "if",
  "or",
  "and",
  "but",
  "not",
  "no",
  "yes",
  "all",
  "any",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "than",
  "too",
  "very",
]);

function normalizeLabel(raw: string): string {
  return raw.trim().toLowerCase();
}

function tokenize(input: string): readonly string[] {
  // Preserve hyphenated compounds (local-first), keep alnum _ -
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned.split(" ").filter((t) => t.length >= 3);
}

export function extractConceptCandidates(summary: string, _eventType?: string): readonly string[] {
  if (!summary || typeof summary !== "string") return [];
  // Never operate on large blobs: caller must pass short summary only.
  const redacted = redactSecrets(summary);
  const tokens = tokenize(redacted);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (STOPWORDS.has(t)) continue;
    const norm = normalizeLabel(t);
    if (norm.length < 3) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

export type ExtractionResult = {
  readonly concepts: readonly ConceptExportRow[];
  readonly references: readonly MemoryReferenceExportRow[];
};

export function applyConceptExtraction(dbPath: string, project: ProjectContext, sourceEventId: string, summary: string, eventType?: string): ExtractionResult {
  const candidates = extractConceptCandidates(summary, eventType);
  const concepts: ConceptExportRow[] = [];
  const references: MemoryReferenceExportRow[] = [];

  for (const label of candidates) {
    // upsertConcept will be made idempotent + bump ref_count by label
    const concept = upsertConcept(dbPath, project, {
      kind: "term",
      label,
      // score/retention left to scorer (Todo 6); default working
    });
    concepts.push(concept);

    const ref = recordMemoryReference(dbPath, project, {
      sourceType: "event",
      sourceId: sourceEventId,
      targetType: "concept",
      targetId: concept.id,
      refKind: "mentions",
      weight: 1,
    });
    references.push(ref);
  }

  return { concepts, references };
}
