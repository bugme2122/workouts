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

// ---------- GAPS #1: newest-wins config, merge-don't-replace presets ----------
import { mergePresetMaps } from "../store.js";

test("local.saveConfig stamps an updatedAt the loader can read back", () => {
  stubLocalStorage();
  assert.equal(local.configUpdatedAt(), 0);
  const before = Date.now();
  local.saveConfig({ people: 3 });
  const at = local.configUpdatedAt();
  assert.ok(at >= before, "timestamp is recorded");
  // The stamp is a sidecar — it must not pollute the config itself (it would ride share links).
  assert.deepEqual(local.loadConfig(), { people: 3 });
});

test("decideMigration keeps cloud-wins when no timestamps are known", () => {
  assert.deepEqual(decideMigration({ a: 1 }, { b: 2 }), { action: "use-cloud", config: { b: 2 } });
});

test("decideMigration prefers a newer local config over a stale cloud one", () => {
  const d = decideMigration({ a: 1 }, { b: 2 }, { localAt: 2000, cloudAt: 1000 });
  assert.deepEqual(d, { action: "upload-local", config: { a: 1 } });
});

test("decideMigration prefers a newer cloud config over a stale local one", () => {
  const d = decideMigration({ a: 1 }, { b: 2 }, { localAt: 1000, cloudAt: 2000 });
  assert.deepEqual(d, { action: "use-cloud", config: { b: 2 } });
});

test("decideMigration falls back to cloud when only one side is stamped", () => {
  assert.equal(decideMigration({ a: 1 }, { b: 2 }, { localAt: 5000 }).action, "use-cloud");
  assert.equal(decideMigration({ a: 1 }, { b: 2 }, { cloudAt: 5000 }).action, "use-cloud");
});

test("decideMigration is unchanged when one side is empty", () => {
  assert.equal(decideMigration({ a: 1 }, null, { localAt: 1, cloudAt: 99 }).action, "upload-local");
  assert.equal(decideMigration(null, { b: 2 }, { localAt: 99, cloudAt: 1 }).action, "use-cloud");
  assert.equal(decideMigration(null, null).action, "none");
});

test("mergePresetMaps keeps local-only presets instead of discarding them", () => {
  const merged = mergePresetMaps({ Local: { x: 1 }, Both: { x: "local" } }, { Cloud: { y: 2 }, Both: { x: "cloud" } });
  assert.deepEqual(Object.keys(merged).sort(), ["Both", "Cloud", "Local"]);
  // Same name on both sides: the cloud copy wins, but nothing is lost.
  assert.deepEqual(merged.Both, { x: "cloud" });
});

test("mergePresetMaps tolerates missing sides", () => {
  assert.deepEqual(mergePresetMaps(null, null), {});
  assert.deepEqual(mergePresetMaps({ A: 1 }, null), { A: 1 });
  assert.deepEqual(mergePresetMaps(null, { B: 2 }), { B: 2 });
});

// ---------- landing page: pinned rows ----------
import { PINS_NS, mergePins } from "../store.js";

test("local pins round-trip and reject junk", () => {
  stubLocalStorage();
  assert.deepEqual(local.loadPins(), []);
  local.savePins(["preset:A", "regimen:B", 42, null]);
  assert.deepEqual(local.loadPins(), ["preset:A", "regimen:B"]);
});

test("splitPresets pulls pins out of the cloud document", () => {
  const doc = { "Leg day": { people: 2 }, [REGIMEN_NS]: { HIIT: {} }, [PINS_NS]: ["preset:Leg day", 7] };
  const { ladder, regimens, pins } = splitPresets(doc);
  assert.deepEqual(Object.keys(ladder), ["Leg day"]);
  assert.deepEqual(Object.keys(regimens), ["HIIT"]);
  assert.deepEqual(pins, ["preset:Leg day"]);
});

test("splitPresets returns no pins when the document has none", () => {
  assert.deepEqual(splitPresets({ A: {} }).pins, []);
  assert.deepEqual(splitPresets(null).pins, []);
});

test("mergePresets round-trips pins and omits the key when empty", () => {
  const doc = mergePresets({ A: { x: 1 } }, { R: {} }, ["preset:A"]);
  assert.deepEqual(doc[PINS_NS], ["preset:A"]);
  assert.deepEqual(splitPresets(doc).pins, ["preset:A"]);
  assert.equal(PINS_NS in mergePresets({ A: {} }, {}, []), false);
  assert.equal(PINS_NS in mergePresets({ A: {} }, {}), false);
});

test("mergePins unions both sides without duplicates", () => {
  assert.deepEqual(mergePins(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
  assert.deepEqual(mergePins(null, ["c"]), ["c"]);
  assert.deepEqual(mergePins(["a"], null), ["a"]);
  assert.deepEqual(mergePins(null, null), []);
});

// ---------- the offline session queue ----------
import { flushSessionQueue } from "../store.js";

test("queueSession stores runs that could not be sent, newest last", () => {
  stubLocalStorage();
  assert.deepEqual(local.loadQueue(), []);
  local.queueSession({ name: "A" });
  local.queueSession({ name: "B" });
  assert.deepEqual(local.loadQueue().map(s => s.name), ["A", "B"]);
});

test("the queue is capped so a long offline spell can't fill storage", () => {
  stubLocalStorage();
  for (let i = 0; i < 60; i++) local.queueSession({ name: "run" + i });
  const q = local.loadQueue();
  assert.equal(q.length, 50);
  assert.equal(q[q.length - 1].name, "run59");   // the newest survive
});

test("flushSessionQueue sends every queued run and empties the queue", async () => {
  stubLocalStorage();
  local.queueSession({ name: "A" });
  local.queueSession({ name: "B" });
  const sent = [];
  const r = await flushSessionQueue({ saveSession: async s => { sent.push(s.name); } });
  assert.deepEqual(sent, ["A", "B"]);
  assert.deepEqual(r, { sent: 2, kept: 0, dropped: 0 });
  assert.deepEqual(local.loadQueue(), []);
});

test("flushSessionQueue keeps the ones that still fail with no status (offline / 5xx)", async () => {
  stubLocalStorage();
  local.queueSession({ name: "good" });
  local.queueSession({ name: "bad" });
  const r = await flushSessionQueue({
    saveSession: async s => { if (s.name === "bad") throw new Error("offline"); },
  });
  assert.deepEqual(r, { sent: 1, kept: 1, dropped: 0 });
  assert.deepEqual(local.loadQueue().map(s => s.name), ["bad"]);
});

// Code review (server #3): a session the API will NEVER accept (a malformed record from a past
// client bug) used to be retried forever, costing a failed request on every sync and eventually
// pushing valid, retryable sessions out past the queue cap. A 4xx now drops it instead of keeping it.
test("flushSessionQueue drops a session the server rejects with 4xx, rather than retrying forever", async () => {
  stubLocalStorage();
  local.queueSession({ name: "malformed" });
  local.queueSession({ name: "offline-when-tried" });
  const r = await flushSessionQueue({
    saveSession: async s => {
      if (s.name === "malformed") { const e = new Error("bad request"); e.status = 400; throw e; }
      const e = new Error("server error"); e.status = 503; throw e;
    },
  });
  assert.deepEqual(r, { sent: 0, kept: 1, dropped: 1 });
  assert.deepEqual(local.loadQueue().map(s => s.name), ["offline-when-tried"]);
});

test("flushSessionQueue is a no-op with no cloud backend", async () => {
  stubLocalStorage();
  local.queueSession({ name: "A" });
  const r = await flushSessionQueue(null);
  assert.deepEqual(r, { sent: 0, kept: 1, dropped: 0 });
  assert.deepEqual(local.loadQueue().map(s => s.name), ["A"]);
});

// Code review (server #2): two overlapping flushes (a double sign-in, a future second call site)
// used to both read the same queue and both POST every entry, with the second saveQueue()
// clobbering the first's result — the visible symptom was the same run appearing twice in History.
test("flushSessionQueue is single-flight: an overlapping call joins the one already running", async () => {
  stubLocalStorage();
  local.queueSession({ name: "A" });
  local.queueSession({ name: "B" });
  let calls = 0;
  let resolveFirst;
  const gate = new Promise(res => { resolveFirst = res; });
  const cloud = {
    saveSession: async s => {
      calls++;
      if (s.name === "A") await gate; // hold the first send open
    },
  };
  const p1 = flushSessionQueue(cloud);
  const p2 = flushSessionQueue(cloud); // fires while p1 is mid-flight
  resolveFirst();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual(r1, r2);          // both callers see the same result...
  assert.equal(calls, 2);            // ...because there was only ever one pass over the queue
  assert.deepEqual(local.loadQueue(), []);
});
