import test from "node:test";
import assert from "node:assert/strict";
import { parseSetPhrase } from "../engine.js";

const ok = (text) => {
  const r = parseSetPhrase(text);
  assert.equal(r.ok, true, text + " -> " + (r.error || ""));
  return r.log;
};
const bad = (text) => {
  const r = parseSetPhrase(text);
  assert.equal(r.ok, false, text + " unexpectedly parsed");
  return r.error;
};

test("reads the canonical spoken shape", () => {
  assert.deepEqual(
    { ...ok("squats 3 sets of 5 at 200 pounds"), note: undefined },
    { exercise: "squats", sets: 3, reps: 5, weight: 200, unit: "lb", note: undefined });
});

test("reads the 3x5 shorthand, with a bare trailing weight", () => {
  const l = ok("deadlift 3x5 315");
  assert.equal(l.exercise, "deadlift");
  assert.equal(l.sets, 3);
  assert.equal(l.reps, 5);
  assert.equal(l.weight, 315);
});

test("reads spelled-out numbers, including compounds", () => {
  const l = ok("kb swings three sets of fifteen at twenty five pounds");
  assert.equal(l.exercise, "kb swings");
  assert.equal(l.sets, 3);
  assert.equal(l.reps, 15);
  assert.equal(l.weight, 25);
  assert.equal(ok("bench press two sets of eight at one hundred eighty pounds").weight, 180);
});

test("understands kilos and keeps the unit", () => {
  const l = ok("front squat 5 reps at 100 kg");
  assert.equal(l.unit, "kg");
  assert.equal(l.weight, 100);
  assert.equal(l.reps, 5);
});

test("marks bodyweight work as bw with no load", () => {
  const l = ok("push ups 3 sets of 12 bodyweight");
  assert.equal(l.unit, "bw");
  assert.equal(l.weight, 0);
  assert.equal(l.exercise, "push ups");
});

test("strips the way people actually start a sentence", () => {
  assert.equal(ok("I just did pull ups 4 sets of 6").exercise, "pull ups");
  assert.equal(ok("logged goblet squats 3x10 at 35 lbs").exercise, "goblet squats");
});

test("defaults a bare exercise to one set of nothing rather than refusing", () => {
  const l = ok("plank");
  assert.equal(l.exercise, "plank");
  assert.equal(l.sets, 1);
  assert.equal(l.reps, 0);
  assert.equal(l.weight, 0);
});

test("keeps the raw phrase as the note, so nothing spoken is lost", () => {
  assert.equal(ok("Squats 3 Sets Of 5 At 200 Pounds").note, "Squats 3 Sets Of 5 At 200 Pounds");
});

test("refuses what it cannot read instead of storing a guess", () => {
  assert.match(bad(""), /nothing to log/i);
  assert.match(bad("   "), /nothing to log/i);
  assert.match(bad("five"), /exercise name/i);
  assert.match(bad("3x5"), /exercise name/i);
});

test("rejects values outside what the API will accept", () => {
  assert.match(bad("squats 200 sets of 5"), /sets/i);
  assert.match(bad("squats 3 sets of 2000"), /reps/i);
  assert.match(bad("squats 3x5 at 99999 pounds"), /weight/i);
});

test("never throws on junk input", () => {
  [null, undefined, 42, {}, "🏋️", "-----"].forEach(v => {
    const r = parseSetPhrase(v);
    assert.equal(typeof r.ok, "boolean");
  });
});
