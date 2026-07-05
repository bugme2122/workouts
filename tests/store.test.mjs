import test from "node:test";
import assert from "node:assert/strict";
import { decideMigration, local } from "../store.js";

// Minimal in-memory localStorage stub for Node.
function stubLocalStorage() {
  const m = new Map();
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
  };
  return m;
}

test("decideMigration prefers cloud when it has data", () => {
  assert.deepEqual(decideMigration({ a: 1 }, { b: 2 }), { action: "use-cloud", config: { b: 2 } });
});
test("decideMigration uploads local when cloud is empty", () => {
  assert.deepEqual(decideMigration({ a: 1 }, null), { action: "upload-local", config: { a: 1 } });
});
test("decideMigration is a no-op when both are empty", () => {
  assert.deepEqual(decideMigration(null, null), { action: "none", config: null });
});
test("local backend round-trips config and presets via localStorage", () => {
  stubLocalStorage();
  assert.equal(local.loadConfig(), null);
  local.saveConfig({ people: 3 });
  assert.deepEqual(local.loadConfig(), { people: 3 });
  assert.deepEqual(local.loadPresets(), {});
  local.savePresets({ A: { x: 1 } });
  assert.deepEqual(local.loadPresets(), { A: { x: 1 } });
});
