import WorkoutState from '../models/WorkoutState.js';

// All handlers are scoped to req.user.id (set by verifyJWT) — a user only ever reads/writes their
// own state. Config/presets are stored/returned as parsed JSON.

export async function getState(req, res) {
  const doc = await WorkoutState.findOne({ userId: req.user.id });
  const config = doc?.configJson ? JSON.parse(doc.configJson) : null;
  res.json({ config });
}

export async function putState(req, res) {
  const config = req.body?.config ?? null;
  await WorkoutState.findOneAndUpdate(
    { userId: req.user.id },
    { $set: { configJson: config == null ? null : JSON.stringify(config) } },
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
  await WorkoutState.findOneAndUpdate(
    { userId: req.user.id },
    { $set: { presetsJson: JSON.stringify(presets) } },
    { upsert: true, new: true }
  );
  res.json({ ok: true });
}

// Delete-all: mirrors the old Firestore deleteAll() — removes the user's config + presets.
export async function deleteAccount(req, res) {
  await WorkoutState.deleteOne({ userId: req.user.id });
  res.status(204).end();
}
