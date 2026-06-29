/**
 * Deterministic retention scoring policy and classification contract.
 * Pure functions. No ML, no embeddings, no side effects, no DB.
 * All inputs are explicit evidence signals (frequency, recency, spread, weights, pin, decay, contradictions).
 */

export type RetentionScoreInput = {
  readonly frequency: number;
  readonly recencyDays: number;
  readonly spread: number;
  readonly decisionWeight: number;
  readonly qaWeight: number;
  readonly relationDegree: number;
  readonly confidence: number;
  readonly manualPin: boolean;
  readonly ageDays: number;
  readonly contradictionCount: number;
};

export const RETENTION_CLASSES = ["forget", "temporary", "working", "durable", "permanent"] as const;

export type RetentionClass = (typeof RETENTION_CLASSES)[number];

/**
 * Minimum score (inclusive) required to enter each class when not manually pinned.
 * Classification walks from highest to lowest.
 */
export const RETENTION_THRESHOLDS = {
  forget: 0,
  temporary: 30,
  working: 50,
  durable: 75,
  permanent: 90,
} as const;

/**
 * Weights and factors for the deterministic linear scoring formula.
 * Exposed so docs and tests can reference exact terms.
 */
export const RETENTION_WEIGHTS = {
  frequency: 4.5,
  spread: 7,
  decision: 12,
  qa: 10,
  relation: 4,
  confidence: 10,
  recencyBase: 18,
  recencyPerDay: 0.55,
  agePerDay: 0.12,
  ageCap: 22,
  contradiction: 9,
} as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Deterministic retention score in [0, 110] range (rounded).
 * Terms: frequency, spread, decision/qa importance, relation degree,
 * confidence, recency bonus, age-based linear decay, contradiction penalty.
 * Manual pin does NOT change the raw score; it forces "permanent" at classify time.
 */
export function computeRetentionScore(input: RetentionScoreInput): number {
  const freqPart = input.frequency * RETENTION_WEIGHTS.frequency;
  const spreadPart = input.spread * RETENTION_WEIGHTS.spread;
  const decisionPart = input.decisionWeight * RETENTION_WEIGHTS.decision;
  const qaPart = input.qaWeight * RETENTION_WEIGHTS.qa;
  const relPart = input.relationDegree * RETENTION_WEIGHTS.relation;
  const confPart = input.confidence * RETENTION_WEIGHTS.confidence;

  let score = freqPart + spreadPart + decisionPart + qaPart + relPart + confPart;

  const recencyBonus = Math.max(0, RETENTION_WEIGHTS.recencyBase - input.recencyDays * RETENTION_WEIGHTS.recencyPerDay);
  score += recencyBonus;

  const ageDecay = Math.min(RETENTION_WEIGHTS.ageCap, input.ageDays * RETENTION_WEIGHTS.agePerDay);
  score -= ageDecay;

  score -= input.contradictionCount * RETENTION_WEIGHTS.contradiction;

  return Math.round(clamp(score, 0, 110));
}

/**
 * Classify a (score, manualPin) pair into one of the five retention classes.
 * Manual pin is a hard override: pinned items are permanent and MUST NOT be
 * auto-expired by any decay job or age-based rule.
 */
export function classifyRetention(score: number, manualPin: boolean): RetentionClass {
  if (manualPin) {
    return "permanent";
  }
  const s = Math.max(0, Math.round(score));
  if (s >= RETENTION_THRESHOLDS.permanent) return "permanent";
  if (s >= RETENTION_THRESHOLDS.durable) return "durable";
  if (s >= RETENTION_THRESHOLDS.working) return "working";
  if (s >= RETENTION_THRESHOLDS.temporary) return "temporary";
  return "forget";
}
