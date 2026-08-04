import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRegimen,
  sanitizeRegimen,
  buildRegimenPhases,
  secondCue,
  REGIMEN_SCHEMA,
} from "../engine.js";

const valid = () => ({
  schema: "regimen@1",
  name: "Full-Body 30",
  defaults: { prep: 10, halfChime: true },
  segments: [
    { type: "work", label: "Push-ups", seconds: 45, say: "Push ups" },
    { type: "rest", seconds: 15 },
    { type: "group", rounds: 3, segments: [
      { type: "work", label: "Burpees", seconds: 30 },
      { type: "rest", seconds: 20 },
    ]},
  ],
});

// ---------- validateRegimen ----------
test("validateRegimen accepts a well-formed regimen", () => {
  const r = validateRegimen(valid());
  assert.equal(r.ok, true);
  assert.equal(r.regimen.name, "Full-Body 30");
});

test("validateRegimen rejects wrong/absent schema, name, segments", () => {
  assert.equal(validateRegimen(null).ok, false);
  assert.equal(validateRegimen([]).ok, false);
  assert.equal(validateRegimen({ name: "x", segments: [{}] }).ok, false); // no schema
  assert.equal(validateRegimen({ schema: REGIMEN_SCHEMA, segments: [{}] }).ok, false); // no name
  assert.equal(validateRegimen({ schema: REGIMEN_SCHEMA, name: " " , segments: [{}] }).ok, false); // blank name
  assert.equal(validateRegimen({ schema: REGIMEN_SCHEMA, name: "x", segments: [] }).ok, false); // empty
  // each failure carries a human-readable message
  assert.equal(typeof validateRegimen(null).error, "string");
});

// ---------- sanitizeRegimen: coercion never throws ----------
test("sanitizeRegimen coerces hostile input and never throws", () => {
  const hostile = {
    schema: "regimen@1",
    name: "   Trim Me   ",
    defaults: { prep: 999, volume: "loud" },
    segments: [
      null,                                   // non-object → coerced
      { type: "bogus", seconds: "40" },       // unknown type → work; string seconds → 40
      { type: "rest", seconds: -5 },          // rest floor 0
      { type: "work", seconds: 0 },           // work floor 1
      { type: "work", label: 123, say: null },// non-string label/say dropped
      { type: "work", seconds: 99999 },       // capped at 3600
    ],
  };
  let r;
  assert.doesNotThrow(() => { r = sanitizeRegimen(hostile); });
  assert.equal(r.name, "Trim Me");
  assert.equal(r.defaults.prep, 60);          // clamped 0..60
  assert.equal(r.defaults.volume, 0.8);       // NaN → default
  const [s0, s1, s2, s3, s4, s5] = r.segments;
  assert.equal(s0.type, "work");              // null coerced
  assert.equal(s1.type, "work");              // bogus → work
  assert.equal(s1.seconds, 40);               // "40" → 40
  assert.equal(s2.seconds, 0);                // rest may be 0
  assert.equal(s3.seconds, 1);                // work floor 1
  assert.ok(!("label" in s4));                // non-string label dropped
  assert.equal(s5.seconds, 3600);             // capped
});

test("sanitizeRegimen caps rounds and total flattened footprint; drops nested groups", () => {
  const big = {
    schema: "regimen@1", name: "Big",
    segments: [
      { type: "group", rounds: 9999, segments: [{ type: "work", seconds: 10 }] },
      { type: "group", rounds: 2, segments: [
        { type: "group", rounds: 2, segments: [{ type: "work", seconds: 5 }] }, // nested → dropped
        { type: "work", seconds: 5 },
      ]},
    ],
  };
  const r = sanitizeRegimen(big);
  const g0 = r.segments[0];
  assert.equal(g0.type, "group");
  assert.ok(g0.rounds <= 500);                // footprint capped to MAX_SEGMENTS
  // second group's nested group was dropped, leaving one leaf
  const g1 = r.segments[1];
  if (g1) assert.equal(g1.segments.length, 1);
});

test("sanitizeRegimen falls back to a default segment when none survive", () => {
  const r = sanitizeRegimen({ schema: "regimen@1", name: "Empty", segments: [] });
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].type, "work");
});

// ---------- buildRegimenPhases ----------
test("buildRegimenPhases flattens groups and prepends prep; total excludes prep", () => {
  const { phases, cum, total } = buildRegimenPhases(sanitizeRegimen(valid()));
  // prep + 2 flat + (3 rounds * 2) = 1 + 2 + 6 = 9 phases
  assert.equal(phases[0].type, "prep");
  assert.equal(phases.length, 9);
  // total = 45 + 15 + 3*(30+20) = 210 (prep excluded)
  assert.equal(total, 210);
  // cum is monotonic non-decreasing
  for (let i = 1; i < cum.length; i++) assert.ok(cum[i] >= cum[i - 1]);
  // per-segment say falls back to label
  const push = phases.find((p) => p.label === "Push-ups");
  assert.equal(push.say, "Push ups");
  const burpee = phases.find((p) => p.label === "Burpees");
  assert.equal(burpee.say, "Burpees"); // no explicit say → label
});

// ---------- TR-3: halfway works through the EXISTING secondCue, no new halfway code ----------
test("a regimen phase >=12s fires the halfway chime via secondCue", () => {
  const { phases } = buildRegimenPhases(sanitizeRegimen(valid()));
  const work = phases.find((p) => p.type === "work" && p.dur >= 12); // 45s or 30s
  const cue = secondCue(work, Math.round(work.dur / 2));
  assert.equal(cue.chime, true);
});

// ---------- TR-4: export → parse → build round-trips to an equivalent phase list ----------
test("exporting and re-importing a regimen yields an equivalent phase list", () => {
  const original = sanitizeRegimen(valid());
  const before = buildRegimenPhases(original);
  // The export path is exactly this serialization (app.js writes it to a Blob).
  const roundTripped = JSON.parse(JSON.stringify(original));
  const v = validateRegimen(roundTripped);
  assert.equal(v.ok, true);
  const after = buildRegimenPhases(sanitizeRegimen(v.regimen));
  assert.deepEqual(after.phases, before.phases);
  assert.deepEqual(after.cum, before.cum);
  assert.equal(after.total, before.total);
});
