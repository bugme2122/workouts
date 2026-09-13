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

test("sanitize coerces a non-object station entry without throwing (crafted-config guard)", () => {
  let c;
  assert.doesNotThrow(() => {
    c = sanitize(migrate({ stations: [null, "oops", 42, { ex: "Real" }], ladder: [[20, 10]] }));
  });
  // null/string/number entries become the safe default "Exercise"; the real one survives.
  assert.equal(c.stations[0].ex, "Exercise");
  assert.equal(c.stations[1].ex, "Exercise");
  assert.equal(c.stations[2].ex, "Exercise");
  assert.equal(c.stations[3].ex, "Real");
});

test("sanitize coerces a non-finite volume to the default, and clamps a numeric one", () => {
  // "loud" -> NaN -> default (0.8 in engine DEFAULTS), NOT NaN (the primary bug)
  assert.equal(sanitize({ volume: "loud", stations: [{ ex: "A" }], ladder: [[20, 10]] }).volume, 0.8);
  // undefined -> NaN via Number() -> default
  assert.equal(sanitize({ stations: [{ ex: "A" }], ladder: [[20, 10]] }).volume, 0.8);
  // null -> Number(null)===0 (finite) -> clamped to 0; never NaN
  assert.equal(sanitize({ volume: null, stations: [{ ex: "A" }], ladder: [[20, 10]] }).volume, 0);
  // a numeric string coerces and clamps into [0,1]
  assert.equal(sanitize({ volume: "0.5", stations: [{ ex: "A" }], ladder: [[20, 10]] }).volume, 0.5);
  assert.equal(sanitize({ volume: 5, stations: [{ ex: "A" }], ladder: [[20, 10]] }).volume, 1);
  assert.equal(sanitize({ volume: -3, stations: [{ ex: "A" }], ladder: [[20, 10]] }).volume, 0);
});

test("sanitize caps huge stations/ladder arrays so the main thread can't stall", () => {
  const stations = Array.from({ length: 500 }, (_, i) => ({ ex: "S" + i }));
  const ladder = Array.from({ length: 500 }, () => [20, 10]);
  const c = sanitize({ stations, ladder, volume: 0.8 });
  assert.equal(c.stations.length, 40);
  assert.equal(c.ladder.length, 60);
});

test("sanitize coerces non-string personNames entries so personLabel .trim() can't throw", () => {
  const c = sanitize({
    people: 3, personNames: [null, 42, { x: 1 }],
    stations: [{ ex: "A" }, { ex: "B" }, { ex: "C" }], ladder: [[20, 10]], volume: 0.8,
  });
  assert.ok(c.personNames.every(n => typeof n === "string"), "all names are strings");
});

test("sanitize survives a fully crafted config (null station + bad volume) without throwing", () => {
  let c;
  assert.doesNotThrow(() => {
    c = sanitize(migrate({ stations: [null], volume: "loud", ladder: [[20, 10]] }));
  });
  assert.equal(c.stations[0].ex, "Exercise");
  assert.equal(c.volume, 0.8);
});

import { secondCue, guestAccessLabel } from "../engine.js";

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

test("guestAccessLabel describes a partial guest allowance", () => {
  assert.equal(guestAccessLabel(5, 2), "2 of 5 workouts");
});

test("guestAccessLabel says 'all' when the allowance covers the catalog", () => {
  assert.equal(guestAccessLabel(5, 5), "All 5 workouts");
  assert.equal(guestAccessLabel(5, 9), "All 5 workouts");
});

test("guestAccessLabel uses the singular for a one-workout allowance", () => {
  assert.equal(guestAccessLabel(5, 1), "1 of 5 workouts");
  assert.equal(guestAccessLabel(1, 1), "All 1 workout");
});

test("guestAccessLabel handles an empty catalog without producing junk", () => {
  assert.equal(guestAccessLabel(0, 2), "No workouts");
});

test("guestAccessLabel clamps a negative allowance to none", () => {
  assert.equal(guestAccessLabel(5, -1), "0 of 5 workouts");
});

// ---------- GAPS #10: boolean coercion + default parity ----------
import { sanitize as sanitizeG10 } from "../engine.js";

test("sanitize coerces boolean fields and fills missing ones from defaults", () => {
  const c = sanitizeG10({ stations: [{ ex: "A" }], ladder: [[30, 15]], voice: "yes", ticks: 0 });
  assert.equal(c.voice, true);
  assert.equal(c.ticks, false);
  // keepAwake/haptics absent from a legacy config fall back to the product defaults.
  assert.equal(c.keepAwake, true);
  assert.equal(c.haptics, false);
  assert.equal(c.halfChime, true);
});

test("sanitize preserves explicitly false booleans", () => {
  const c = sanitizeG10({ stations: [{ ex: "A" }], ladder: [[30, 15]], keepAwake: false, halfChime: false });
  assert.equal(c.keepAwake, false);
  assert.equal(c.halfChime, false);
});

// ---------- GAPS #3/#5: pure boot + idle decisions ----------
import { decideBoot, isIdle } from "../engine.js";

test("decideBoot deep-links a genuine share recipient", () => {
  assert.deepEqual(decideBoot("#w=tabata", false), {
    bootedFromShare: true, freshShare: true, screen: "live", configSource: "share", clearHash: false,
  });
});

test("decideBoot ignores a stale share hash for a returning user", () => {
  const d = decideBoot("#c=abc", true);
  assert.equal(d.freshShare, false);
  assert.equal(d.screen, "welcome");
  // GAPS #5: the hash must not half-apply — config comes from localStorage, not the link.
  assert.equal(d.configSource, "local");
  assert.equal(d.clearHash, true);
});

test("decideBoot on a normal load shows welcome and reads local config", () => {
  assert.deepEqual(decideBoot("", true), {
    bootedFromShare: false, freshShare: false, screen: "welcome", configSource: "local", clearHash: false,
  });
});

test("decideBoot tolerates a hash that is not a share link", () => {
  const d = decideBoot("#settings", false);
  assert.equal(d.bootedFromShare, false);
  assert.equal(d.screen, "welcome");
});

test("isIdle is true only on home/welcome with nothing running", () => {
  assert.equal(isIdle({ activeScreen: "home", running: false, freshShare: false }), true);
  assert.equal(isIdle({ activeScreen: "welcome", running: false, freshShare: false }), true);
  assert.equal(isIdle({ activeScreen: "live", running: false, freshShare: false }), false);
  assert.equal(isIdle({ activeScreen: "home", running: true, freshShare: false }), false);
  assert.equal(isIdle({ activeScreen: "home", running: false, freshShare: true }), false);
});

// ---------- GAPS #7: backgrounded-tab catch-up ----------
import { advancePhases } from "../engine.js";

test("advancePhases lands on the next phase with the leftover carried", () => {
  const phases = [{ dur: 5 }, { dur: 10 }, { dur: 10 }];
  const r = advancePhases(phases, 0, -2000);
  assert.equal(r.idx, 1);
  assert.equal(r.remaining, 8000);
  assert.equal(r.finished, false);
  assert.deepEqual(r.skipped, []);
});

test("advancePhases reports skipped phases when a hidden tab misses several", () => {
  const phases = [{ dur: 5 }, { dur: 10 }, { dur: 10 }, { dur: 10 }];
  const r = advancePhases(phases, 0, -25000);
  assert.equal(r.idx, 3);
  assert.equal(r.remaining, 5000);
  // Only the landed-on phase should be announced; 1 and 2 flew past while hidden.
  assert.deepEqual(r.skipped, [1, 2]);
});

test("advancePhases finishes when the run overruns the last phase", () => {
  const phases = [{ dur: 5 }, { dur: 10 }];
  const r = advancePhases(phases, 1, -3000);
  assert.equal(r.finished, true);
  assert.equal(r.idx, 1);
  assert.equal(r.remaining, 0);
});

// ---------- GAPS #11: share-link codec without deprecated escape/unescape ----------
import { enc as encG11, dec as decG11 } from "../engine.js";

test("enc/dec round-trip non-ASCII without escape/unescape", () => {
  const cfg = { name: "Café ✨ 日本", stations: [{ ex: "Björn" }] };
  assert.deepEqual(decG11(encG11(cfg)), cfg);
});

test("dec still decodes a link produced by the legacy escape/unescape encoder", () => {
  // Byte-identical to the old encoder's output for {"a":"é"} (UTF-8 -> binary -> btoa).
  const legacy = btoa(unescape(encodeURIComponent(JSON.stringify({ a: "é" }))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.deepEqual(decG11(legacy), { a: "é" });
});

test("enc output is byte-identical to the legacy encoder", () => {
  const cfg = { a: "é", b: [1, 2], c: "plain" };
  const legacy = btoa(unescape(encodeURIComponent(JSON.stringify(cfg))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(encG11(cfg), legacy);
});

// ---------- landing page: config summaries and preset classification ----------
import { summarizeConfig, classifyPreset, gearOf } from "../engine.js";

const ladderCfg = {
  prep: 5, people: 2, targetMin: 0,
  ladder: [[60, 30], [50, 25], [40, 20], [30, 15], [20, 10]],
  stations: [{ ex: "A", gear: "25 lb" }, { ex: "B", gear: "Rope" }, { ex: "C", gear: "25 lb" }],
};

test("summarizeConfig derives its numbers from buildPhases", () => {
  const s = summarizeConfig(ladderCfg);
  // 3 stations, one 300s block each => 900s = 15 min. prep is not counted as work.
  assert.equal(s.totalSec, 900);
  assert.equal(s.minutes, 15);
  assert.equal(s.blocks, 3);
  assert.equal(s.stations, 3);
  assert.equal(s.intervals, 5);
  assert.equal(s.people, 2);
});

test("summarizeConfig never reports a zero-minute workout", () => {
  const s = summarizeConfig({ prep: 0, people: 1, targetMin: 0, ladder: [[5, 0]], stations: [{ ex: "A" }] });
  assert.equal(s.minutes, 1);
});

test("classifyPreset calls an unchanged catalog circuit a saved setup", () => {
  const base = { stations: [{ ex: "A" }], ladder: [[30, 15]] };
  const preset = { stations: [{ ex: "A" }], ladder: [[30, 15]], people: 4 };
  assert.equal(classifyPreset(preset, base), "saved");
});

test("classifyPreset calls a changed catalog circuit edited", () => {
  const base = { stations: [{ ex: "A" }, { ex: "B" }], ladder: [[30, 15]] };
  const preset = { stations: [{ ex: "A" }], ladder: [[30, 15]] };
  assert.equal(classifyPreset(preset, base), "edited");
});

test("classifyPreset falls back to saved when the workout is not in the catalog", () => {
  assert.equal(classifyPreset({ stations: [], ladder: [] }, null), "saved");
});

test("gearOf lists distinct gear in station order", () => {
  assert.deepEqual(gearOf(ladderCfg), ["25 lb", "Rope"]);
  assert.deepEqual(gearOf({ stations: [{ ex: "A" }, { ex: "B", gear: "  " }] }), []);
  assert.deepEqual(gearOf({}), []);
});

test("sanitize survives non-array stations/ladder/personNames from a crafted link", () => {
  // "nope".slice() is a string, and a string has no .map — this used to throw at boot,
  // which a hostile #c= link could trigger.
  const c = sanitizeG10({ stations: "nope", ladder: "nope", personNames: "nope", people: 3 });
  assert.deepEqual(c.stations, [{ ex: "Exercise", gear: "", rep: "" }]);
  assert.deepEqual(c.ladder, [[30, 15]]);
  assert.deepEqual(c.personNames, []);
  assert.equal(c.people, 1);   // clamped to the one surviving station
});

test("sanitize survives a numeric ladder and object stations", () => {
  const c = sanitizeG10({ stations: { a: 1 }, ladder: 7 });
  assert.equal(c.stations.length, 1);
  assert.deepEqual(c.ladder, [[30, 15]]);
});
