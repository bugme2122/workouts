import test from "node:test";
import assert from "node:assert/strict";

// ---------- landing page: the user's library ----------
import { buildLibrary, WORKOUTS as CATALOG } from "../catalog.js";

const kb = CATALOG.find(w => w.id === "kb-ladder");

test("buildLibrary turns presets into rows with derived numbers", () => {
  const rows = buildLibrary({
    presets: { "Sunday long one": { workoutId: "kb-ladder", people: 2, prep: 5, targetMin: 0,
      ladder: [[60, 30]], stations: [{ ex: "A" }, { ex: "B" }] } },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Sunday long one");
  assert.equal(rows[0].kind, "preset");
  assert.equal(rows[0].people, 2);
  assert.equal(rows[0].stations, 2);
  assert.ok(rows[0].minutes > 0);
  assert.equal(rows[0].pinned, false);
});

test("buildLibrary marks a preset that diverged from its catalog workout as edited", () => {
  const trimmed = {
    workoutId: "kb-ladder", people: 2, prep: 5, targetMin: 0,
    ladder: JSON.parse(JSON.stringify(kb.ladder)),
    stations: JSON.parse(JSON.stringify(kb.stations)).slice(0, 3),
  };
  const same = {
    workoutId: "kb-ladder", people: 2, prep: 5, targetMin: 0,
    ladder: JSON.parse(JSON.stringify(kb.ladder)),
    stations: JSON.parse(JSON.stringify(kb.stations)),
  };
  const rows = buildLibrary({ presets: { Trimmed: trimmed, Untouched: same } });
  const byName = Object.fromEntries(rows.map(r => [r.name, r]));
  assert.equal(byName.Trimmed.origin, "edited");
  assert.equal(byName.Trimmed.from, kb.name);
  assert.equal(byName.Untouched.origin, "saved");
  assert.equal(byName.Untouched.from, "");
});

test("buildLibrary turns an uploaded regimen into a row with expanded group time", () => {
  const rows = buildLibrary({
    regimens: {
      "Garage Tabata": {
        schema: "regimen@1", name: "Garage Tabata",
        segments: [
          { type: "work", seconds: 20, label: "Burpees" },
          { type: "rest", seconds: 10 },
          { type: "group", rounds: 3, segments: [{ type: "work", seconds: 30 }, { type: "rest", seconds: 15 }] },
        ],
      },
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].origin, "uploaded");
  assert.equal(rows[0].kind, "regimen");
  // 20 + 10 + 3 * 45 = 165s -> 3 min
  assert.equal(rows[0].minutes, 3);
  // Segments are counted flattened (2 top-level leaves + 3 rounds x 2), matching the live view.
  assert.equal(rows[0].stations, 8);
  // The strip shows every flattened pair, so a 3-round group draws three peaks, not one slab.
  assert.deepEqual(rows[0].ladder, [[20, 10], [30, 15], [30, 15], [30, 15]]);
});

test("buildLibrary sorts pinned rows first, then by name", () => {
  const rows = buildLibrary({
    presets: {
      Zulu:  { ladder: [[30, 15]], stations: [{ ex: "A" }] },
      Alpha: { ladder: [[30, 15]], stations: [{ ex: "A" }] },
      Mike:  { ladder: [[30, 15]], stations: [{ ex: "A" }] },
    },
    pins: ["preset:Zulu"],
  });
  assert.deepEqual(rows.map(r => r.name), ["Zulu", "Alpha", "Mike"]);
  assert.equal(rows[0].pinned, true);
});

test("buildLibrary is empty and does not throw with nothing stored", () => {
  assert.deepEqual(buildLibrary(), []);
  assert.deepEqual(buildLibrary({ presets: {}, regimens: {}, pins: [] }), []);
});

test("buildLibrary sanitizes preset data before deriving anything", () => {
  // A crafted preset from the cloud must not reach the row untouched.
  const rows = buildLibrary({ presets: { Nasty: { stations: [null, { ex: "<img src=x>" }], ladder: "nope", people: 99 } } });
  assert.equal(rows[0].stations, 2);
  assert.ok(rows[0].people <= 6);
  assert.ok(Array.isArray(rows[0].ladder));
});

test("every catalog workout has a blurb short enough for a card", () => {
  CATALOG.forEach(w => {
    assert.equal(typeof w.blurb, "string", w.id + " has a blurb");
    assert.ok(w.blurb.length > 0 && w.blurb.length <= 90, w.id + " blurb length " + w.blurb.length);
  });
});
