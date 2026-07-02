import test from "node:test";
import assert from "node:assert/strict";
import { blockLenOf } from "../engine.js";

test("blockLenOf sums on+off across the ladder", () => {
  const cfg = { ladder: [[60, 30], [50, 25], [40, 20], [30, 15], [20, 10]] };
  assert.equal(blockLenOf(cfg), 300);
});

import { blocksFor, buildPhases, enc, dec } from "../engine.js";

const base = {
  prep: 5,
  ladder: [[60, 30], [50, 25], [40, 20], [30, 15], [20, 10]],
  stations: [{ ex: "A" }, { ex: "B" }, { ex: "C" }, { ex: "D" }, { ex: "E" }, { ex: "F" }],
};

test("blocksFor defaults to station count when no target", () => {
  assert.equal(blocksFor({ ...base, targetMin: 0 }), 6);
});

test("blocksFor derives block count from targetMin", () => {
  // block length = 300s; 30 min => 1800/300 = 6 blocks
  assert.equal(blocksFor({ ...base, targetMin: 30 }), 6);
});

test("buildPhases produces prep + on/off per interval per block", () => {
  const r = buildPhases({ ...base, targetMin: 0 });
  assert.equal(r.N, 6);
  assert.equal(r.LADN, 5);
  assert.equal(r.TOTBLOCKS, 6);
  // 1 prep + (5 intervals * 2 phases) * 6 blocks = 1 + 60 = 61
  assert.equal(r.phases.length, 61);
  assert.equal(r.phases[0].type, "prep");
  assert.equal(r.total, 300 * 6); // prep excluded from total
});

test("enc/dec round-trips a config", () => {
  const round = dec(enc(base));
  assert.deepEqual(round.ladder, base.ladder);
});

import { offsetFor, clampPeople, occupants, migrate, sanitize } from "../engine.js";

test("offsetFor for 2 people equals legacy floor(N/2)", () => {
  assert.equal(offsetFor(1, 2, 6), 3); // matches old OFFSET = floor(6/2)
  assert.equal(offsetFor(0, 2, 6), 0);
});

test("occupants spreads P people around N stations, wrapping", () => {
  // block 0, 3 people, 6 stations => stations 0,2,4
  assert.deepEqual(occupants(0, 3, 6).map(o => o.station), [0, 2, 4]);
  // block 5 wraps: 5,7%6=1,9%6=3
  assert.deepEqual(occupants(5, 3, 6).map(o => o.station), [5, 1, 3]);
});

test("clampPeople never exceeds stations or 6, never below 1", () => {
  assert.equal(clampPeople(6, 4), 4); // 6 people, 4 stations => 4
  assert.equal(clampPeople(9, 8), 6); // cap at 6
  assert.equal(clampPeople(0, 6), 1); // floor at 1
});

test("migrate maps legacy mode to people and drops mode", () => {
  const solo = migrate({ mode: "solo", stations: [{ ex: "A" }], ladder: [[20, 10]] });
  assert.equal(solo.people, 1);
  assert.equal(solo.mode, undefined);
  const duo = migrate({ mode: "duo", stations: [{ ex: "A" }], ladder: [[20, 10]] });
  assert.equal(duo.people, 2);
});

test("sanitize clamps people to station count and trims names", () => {
  const c = sanitize({
    people: 6, personNames: ["Ana", "Ben", "Cam", "Dev"],
    stations: [{ ex: "A" }, { ex: "B" }, { ex: "C" }], ladder: [[20, 10]],
    prep: 5, targetMin: 0, volume: 0.8, theme: "Volt",
  });
  assert.equal(c.people, 3);            // capped to 3 stations
  assert.equal(c.personNames.length, 3); // trimmed to people
});

test("occupants never returns an out-of-range station when block >= N (F1)", () => {
  const N = 6, P = 1;
  for (let block = 0; block < 20; block++) {
    for (const o of occupants(block, P, N)) {
      assert.ok(o.station >= 0 && o.station < N, `station ${o.station} out of range at block ${block}`);
    }
  }
});

test("sanitize(migrate(...)) repairs empty stations and clamps people (load-path guard)", () => {
  const c = sanitize(migrate({ stations: [], people: 6, ladder: [[20, 10]] }));
  assert.ok(c.stations.length >= 1, "stations repaired to non-empty");
  assert.ok(c.people >= 1 && c.people <= Math.min(6, c.stations.length), "people clamped to stations");
});
test("sanitize drops non-http(s) station urls", () => {
  const c = sanitize({ people: 1, prep: 5, targetMin: 0, volume: 0.8,
    ladder: [[20, 10]], stations: [{ ex: "X", url: "javascript:alert(1)" }] });
  assert.equal(c.stations[0].url, "");
});

import { secondCue } from "../engine.js";

test("secondCue: prep speaks only the last 3 seconds, with beep", () => {
  assert.deepEqual(secondCue({ type: "prep", dur: 5 }, 3), { speak: "3", beep: true, chime: false });
  assert.deepEqual(secondCue({ type: "prep", dur: 5 }, 1), { speak: "1", beep: true, chime: false });
  assert.deepEqual(secondCue({ type: "prep", dur: 5 }, 4), { speak: null, beep: false, chime: false });
  assert.deepEqual(secondCue({ type: "prep", dur: 5 }, 5), { speak: null, beep: false, chime: false });
});

test("secondCue: work/rest speak the last 5 seconds, with beep", () => {
  assert.deepEqual(secondCue({ type: "work", dur: 60 }, 5), { speak: "5", beep: true, chime: false });
  assert.deepEqual(secondCue({ type: "rest", dur: 60 }, 1), { speak: "1", beep: true, chime: false });
  assert.deepEqual(secondCue({ type: "work", dur: 60 }, 6), { speak: null, beep: false, chime: false });
});

test("secondCue: chimes at the halfway second only when dur >= 12", () => {
  assert.equal(secondCue({ type: "work", dur: 60 }, 30).chime, true);
  assert.equal(secondCue({ type: "work", dur: 12 }, 6).chime, true);
  assert.equal(secondCue({ type: "work", dur: 11 }, 6).chime, false); // guard boundary
  assert.equal(secondCue({ type: "rest", dur: 10 }, 5).chime, false);  // short rest: no chime
});

test("secondCue: never speaks and chimes in the same second", () => {
  assert.deepEqual(secondCue({ type: "work", dur: 12 }, 6), { speak: null, beep: false, chime: true });
  assert.deepEqual(secondCue({ type: "work", dur: 12 }, 5), { speak: "5", beep: true, chime: false });
});

test("secondCue: a 1s interval is silent at every second", () => {
  for (let s = 0; s <= 1; s++) {
    assert.deepEqual(secondCue({ type: "work", dur: 1 }, s), { speak: null, beep: false, chime: false });
  }
});
