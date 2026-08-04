import test from "node:test";
import assert from "node:assert/strict";
import { decideMigration, local, splitPresets, mergePresets, REGIMEN_NS } from "../store.js";

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

// ---------- BYOW: regimen presets are namespaced away from ladder presets ----------
test("splitPresets separates the regimen namespace from ladder presets", () => {
  const doc = { "Leg day": { people: 2 }, [REGIMEN_NS]: { "HIIT": { schema: "regimen@1" } } };
  const { ladder, regimens } = splitPresets(doc);
  assert.deepEqual(Object.keys(ladder), ["Leg day"]);
  assert.deepEqual(Object.keys(regimens), ["HIIT"]);
});

test("splitPresets tolerates a missing or malformed namespace", () => {
  assert.deepEqual(splitPresets({}).regimens, {});
  assert.deepEqual(splitPresets(null).ladder, {});
  assert.deepEqual(splitPresets({ [REGIMEN_NS]: "nope" }).regimens, {});
});

test("mergePresets round-trips through splitPresets", () => {
  const ladder = { "Leg day": { people: 2 } };
  const regimens = { "HIIT": { schema: "regimen@1", name: "HIIT" } };
  const back = splitPresets(mergePresets(ladder, regimens));
  assert.deepEqual(back.ladder, ladder);
  assert.deepEqual(back.regimens, regimens);
});

test("mergePresets omits the namespace key when there are no regimens", () => {
  const merged = mergePresets({ a: 1 }, {});
  assert.equal(Object.prototype.hasOwnProperty.call(merged, REGIMEN_NS), false);
});

test("a ladder preset cannot shadow the reserved regimen namespace", () => {
  // Even if a stray ladder preset used the reserved key, merge drops it.
  const merged = mergePresets({ [REGIMEN_NS]: { evil: true }, ok: 1 }, { R: {} });
  assert.deepEqual(merged[REGIMEN_NS], { R: {} });
});

test("local backend round-trips the active regimen and regimen presets", () => {
  stubLocalStorage();
  assert.equal(local.loadRegimen(), null);
  const r = { schema: "regimen@1", name: "Test", segments: [] };
  local.saveRegimen(r);
  assert.deepEqual(local.loadRegimen(), r);
  local.saveRegimen(null);                    // clearing removes the key
  assert.equal(local.loadRegimen(), null);
  assert.deepEqual(local.loadRegimenPresets(), {});
  local.saveRegimenPresets({ A: r });
  assert.deepEqual(local.loadRegimenPresets(), { A: r });
});
