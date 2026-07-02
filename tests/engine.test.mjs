import test from "node:test";
import assert from "node:assert/strict";
import { blockLenOf } from "../engine.js";

test("blockLenOf sums on+off across the ladder", () => {
  const cfg = { ladder: [[60, 30], [50, 25], [40, 20], [30, 15], [20, 10]] };
  assert.equal(blockLenOf(cfg), 300);
});
