import WorkoutState from '../models/WorkoutState.js';

// Cap on a single stored blob (GAPS #16). The largest legitimate config/preset document is a few
// KB; 64 KB is generous. The server must not trust the client's sanitize — a compromised session
// could otherwise stash arbitrary data in its own document (a quota/cost problem, not a breach,
// since every query is scoped by userId).
const MAX_JSON_BYTES = 64 * 1024;

// Serialize, or reject with 413 if the result is oversized. Returns null when the payload is null.
function serializeCapped(value, field, res) {
  if (value == null) return { ok: true, json: null };
  const json = JSON.stringify(value);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_JSON_BYTES) {
    res.status(413).json({ error: `${field} is too large (${bytes} bytes, max ${MAX_JSON_BYTES}).` });
    return { ok: false };
  }
  return { ok: true, json };
}

// All handlers are scoped to req.user.id (set by verifyJWT) — a user only ever reads/writes their
// own state. Config/presets are stored/returned as parsed JSON.

export async function getState(req, res) {
  const doc = await WorkoutState.findOne({ userId: req.user.id });
  const config = doc?.configJson ? JSON.parse(doc.configJson) : null;
  // updatedAt lets the client decide newest-wins on sign-in instead of always clobbering local
  // edits with the cloud copy (GAPS #1).
  res.json({ config, updatedAt: doc?.updatedAt ?? null });
}

export async function putState(req, res) {
  const config = req.body?.config ?? null;
  const enc = serializeCapped(config, 'config', res);
  if (!enc.ok) return;
  await WorkoutState.findOneAndUpdate(
    { userId: req.user.id },
    { $set: { configJson: enc.json } },
    { upsert: true, new: true }
  );
  res.json({ ok: true });
}

export async function getPresets(req, res) {
  const doc = await WorkoutState.findOne({ userId: req.user.id });
  const presets = doc?.presetsJson ? JSON.parse(doc.presetsJson) : {};
  res.json({ presets });
}

export async function putPresets(req, res) {
  const presets = req.body?.presets ?? {};
  const enc = serializeCapped(presets, 'presets', res);
  if (!enc.ok) return;
  await WorkoutState.findOneAndUpdate(
    { userId: req.user.id },
    { $set: { presetsJson: enc.json } },
    { upsert: true, new: true }
  );
  res.json({ ok: true });
}

// Delete-all: mirrors the old Firestore deleteAll() — removes the user's config + presets.
export async function deleteAccount(req, res) {
  await WorkoutState.deleteOne({ userId: req.user.id });
  res.status(204).end();
}
