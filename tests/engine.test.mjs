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
