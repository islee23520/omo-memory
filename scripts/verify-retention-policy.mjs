#!/usr/bin/env node
/**
 * Focused verification for Todo 3 retention scoring policy contract.
 * Runs against dist/ exports after build.
 * RED: fails when no retentionPolicy module or symbols (before impl).
 * GREEN: maps boundaries + pin permanent despite decay.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const distPolicy = join(root, "dist", "retentionPolicy.js");

function fail(msg) {
  console.error("VERIFY FAIL:", msg);
  process.exit(1);
}

if (!existsSync(distPolicy)) {
  console.error("RED: dist/retentionPolicy.js missing (no scoring contract built)");
}

let retentionPolicy;
try {
  retentionPolicy = await import(distPolicy);
} catch (err) {
  console.error("RED BASELINE (expected before impl):", err?.message ? err.message : err);
  console.error("Boundary proof script requires: computeRetentionScore, classifyRetention, RETENTION_THRESHOLDS, RETENTION_CLASSES from retentionPolicy");
  process.exit(2); // distinct code for missing contract
}

const { computeRetentionScore, classifyRetention, RETENTION_THRESHOLDS, RETENTION_CLASSES } = retentionPolicy;

if (typeof computeRetentionScore !== "function") fail("computeRetentionScore not exported function");
if (typeof classifyRetention !== "function") fail("classifyRetention not exported function");
if (!RETENTION_THRESHOLDS || typeof RETENTION_THRESHOLDS !== "object") fail("RETENTION_THRESHOLDS missing");
if (!Array.isArray(RETENTION_CLASSES) || RETENTION_CLASSES.length === 0) fail("RETENTION_CLASSES missing");

const classes = RETENTION_CLASSES;
if (!classes.includes("forget") || !classes.includes("permanent")) fail("classes incomplete");

// Boundary fixtures using direct scores for classifier (deterministic thresholds)
const boundaryCases = [
  { score: 29, pin: false, expect: "forget" },
  { score: 30, pin: false, expect: "temporary" },
  { score: 49, pin: false, expect: "temporary" },
  { score: 50, pin: false, expect: "working" },
  { score: 74, pin: false, expect: "working" },
  { score: 75, pin: false, expect: "durable" },
  { score: 89, pin: false, expect: "durable" },
  { score: 90, pin: false, expect: "permanent" },
];

console.log("=== Boundary threshold mappings ===");
for (const c of boundaryCases) {
  const got = classifyRetention(c.score, c.pin);
  console.log(`score=${c.score} pin=${c.pin} -> ${got} (expect ${c.expect})`);
  if (got !== c.expect) fail(`boundary ${c.score} gave ${got}, want ${c.expect}`);
}

// Full compute fixtures that land in each class (pure, fixed inputs)
const computeFixtures = [
  {
    name: "low-oneoff",
    input: {
      frequency: 1,
      recencyDays: 40,
      spread: 1,
      decisionWeight: 0,
      qaWeight: 0,
      relationDegree: 0,
      confidence: 0.2,
      manualPin: false,
      ageDays: 90,
      contradictionCount: 0,
    },
    expectClass: "forget",
  },
  {
    name: "edge-temp",
    input: {
      frequency: 2,
      recencyDays: 20,
      spread: 1,
      decisionWeight: 0,
      qaWeight: 0,
      relationDegree: 1,
      confidence: 0.5,
      manualPin: false,
      ageDays: 10,
      contradictionCount: 0,
    },
    expectClass: "temporary",
  },
  {
    name: "mid-working",
    input: {
      frequency: 3,
      recencyDays: 5,
      spread: 1,
      decisionWeight: 1,
      qaWeight: 0,
      relationDegree: 1,
      confidence: 0.6,
      manualPin: false,
      ageDays: 5,
      contradictionCount: 0,
    },
    expectClass: "working",
  },
  {
    name: "durable-xp",
    input: {
      frequency: 4,
      recencyDays: 2,
      spread: 2,
      decisionWeight: 1,
      qaWeight: 1,
      relationDegree: 2,
      confidence: 0.7,
      manualPin: false,
      ageDays: 1,
      contradictionCount: 0,
    },
    expectClass: "durable",
  },
  {
    name: "permanent-high",
    input: {
      frequency: 8,
      recencyDays: 0,
      spread: 3,
      decisionWeight: 1,
      qaWeight: 1,
      relationDegree: 3,
      confidence: 0.95,
      manualPin: false,
      ageDays: 0,
      contradictionCount: 0,
    },
    expectClass: "permanent",
  },
];

console.log("\n=== Compute + classify fixtures (all five classes) ===");
for (const f of computeFixtures) {
  const score = computeRetentionScore(f.input);
  const cls = classifyRetention(score, f.input.manualPin);
  console.log(`${f.name}: score=${score} class=${cls} (expect ${f.expectClass})`);
  if (cls !== f.expectClass) fail(`fixture ${f.name} class ${cls} != ${f.expectClass}`);
}

// Adversarial: manual pin permanent must survive decay/old/low-freq (no auto-expire)
const pinnedOld = {
  frequency: 1,
  recencyDays: 400,
  spread: 1,
  decisionWeight: 0,
  qaWeight: 0,
  relationDegree: 0,
  confidence: 0.1,
  manualPin: true,
  ageDays: 999,
  contradictionCount: 0,
};
const pinnedScore = computeRetentionScore(pinnedOld);
const pinnedClass = classifyRetention(pinnedScore, pinnedOld.manualPin);
console.log(`\n=== Manual pin permanent vs decay: score=${pinnedScore} class=${pinnedClass} ===`);
if (pinnedClass !== "permanent") {
  fail(`pinned permanent decayed to ${pinnedClass} (score ${pinnedScore}); policy violation`);
}
if (pinnedScore < 100) {
  console.log("Note: low raw score but class forced permanent by pin (correct)");
}

console.log("\nVERIFY PASS: all boundary + class + pin-permanent cases satisfied");
console.log("RETENTION_CLASSES:", JSON.stringify(RETENTION_CLASSES));
console.log("THRESHOLDS:", JSON.stringify(RETENTION_THRESHOLDS));
process.exit(0);
