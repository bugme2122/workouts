import test from "node:test";
import assert from "node:assert/strict";
import { sameCircuit, lightDelta, applyLight, LIGHT_FIELDS } from "../engine.js";
import { encShare, decShare, workoutToConfig, WORKOUTS, sanitize } from "../catalog.js";

// --- engine helpers ---
const A = { stations: [{ ex: "A" }, { ex: "B" }], ladder: [[20, 10]] };

test("sameCircuit: identical stations+ladder is true", () => {
  assert.equal(sameCircuit({ ...A }, { stations: [{ ex: "A" }, { ex: "B" }], ladder: [[20, 10]] }), true);
});
test("sameCircuit: an edited station or ladder is false", () => {
  assert.equal(sameCircuit(A, { stations: [{ ex: "A" }, { ex: "Z" }], ladder: [[20, 10]] }), false);
  assert.equal(sameCircuit(A, { stations: [{ ex: "A" }, { ex: "B" }], ladder: [[30, 10]] }), false);
});
test("LIGHT_FIELDS excludes stations and ladder", () => {
  assert.ok(!LIGHT_FIELDS.includes("stations"));
  assert.ok(!LIGHT_FIELDS.includes("ladder"));
  assert.ok(LIGHT_FIELDS.includes("people") && LIGHT_FIELDS.includes("theme"));
});
test("lightDelta captures only changed light fields; applyLight restores them", () => {
  const base = { people: 2, theme: "Volt", targetMin: 0, personNames: [] };
  const cfg = { people: 4, theme: "Volt", targetMin: 30, personNames: ["Ana"] };
  const d = lightDelta(cfg, base, ["people", "theme", "targetMin", "personNames"]);
  assert.deepEqual(d, { people: 4, targetMin: 30, personNames: ["Ana"] }); // theme unchanged -> omitted
  const restored = applyLight(base, d);
  assert.equal(restored.people, 4);
  assert.equal(restored.targetMin, 30);
  assert.deepEqual(restored.personNames, ["Ana"]);
});
test("lightDelta of identical configs is empty", () => {
  const base = { people: 2, theme: "Volt" };
  assert.deepEqual(lightDelta({ people: 2, theme: "Volt" }, base, ["people", "theme"]), {});
});

// --- catalog encShare/decShare round-trips ---
const kb = WORKOUTS.find(w => w.id === "kb-ladder");

test("encShare: unedited catalog workout -> bare w=<id>", () => {
  const cfg = sanitize(workoutToConfig(kb));
  assert.equal(encShare(cfg), "w=kb-ladder");
});
test("encShare/decShare round-trips a light tweak via w=<id>~tail", () => {
  const cfg = sanitize(workoutToConfig(kb));
  cfg.people = 3; cfg.targetMin = 30; cfg.personNames = ["Ana", "Ben", "Cam"];
  const hash = encShare(cfg);
  assert.ok(hash.startsWith("w=kb-ladder~"), "expected short w= form, got " + hash);
  const back = decShare(hash);
  assert.equal(back.people, 3);
  assert.equal(back.targetMin, 30);
  assert.deepEqual(back.personNames, ["Ana", "Ben", "Cam"]);
  assert.deepEqual(back.stations, cfg.stations); // circuit came from the catalog baseline
});
test("encShare falls back to c= for an edited circuit and round-trips", () => {
  const cfg = sanitize(workoutToConfig(kb));
  cfg.stations[0].ex = "Custom Move";
  const hash = encShare(cfg);
  assert.ok(hash.startsWith("c="), "expected full c= form, got " + hash);
  const back = decShare(hash);
  assert.equal(back.stations[0].ex, "Custom Move");
});
test("decShare tolerates a leading # and an unknown id without throwing", () => {
  assert.deepEqual(decShare("#w=kb-ladder"), decShare("w=kb-ladder"));
  const back = decShare("w=does-not-exist");
  assert.ok(back && Array.isArray(back.stations) && back.stations.length >= 1);
});

test("encShare/decShare round-trips every light field at once", () => {
  const kb = WORKOUTS.find(w => w.id === "kb-ladder");
  const cfg = sanitize(workoutToConfig(kb));
  Object.assign(cfg, {
    people: 5, personNames: ["Ана", "Ben", "Cam", "Dev", "Eli"],
    targetMin: 45, theme: "Ember", prep: 8, volume: 0.5,
    voice: false, ticks: false, haptics: true, keepAwake: false, halfChime: false,
  });
  const hash = encShare(cfg);
  assert.ok(hash.startsWith("w=kb-ladder~"), "expected short w= form, got " + hash);
  const back = decShare(hash);
  for (const f of ["people", "targetMin", "theme", "prep", "volume", "voice", "ticks", "haptics", "keepAwake", "halfChime"]) {
    assert.deepEqual(back[f], cfg[f], "field " + f + " did not round-trip");
  }
  assert.deepEqual(back.personNames, cfg.personNames);
  assert.deepEqual(back.stations, cfg.stations); // circuit from catalog baseline
});
