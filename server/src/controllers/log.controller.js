import mongoose from 'mongoose';
import WorkoutSession from '../models/WorkoutSession.js';
import SetLog from '../models/SetLog.js';

// Every handler is scoped to req.user.id (set by verifyJWT) — a user only ever reads or writes
// their own sessions and logs. Validation is explicit and answers 400 rather than letting
// Mongoose throw, so the message is usable in the UI.

const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const clampLimit = (v) => Math.max(1, Math.min(200, parseInt(v) || 50));
const MAX_SCAN = 2000; // sessions read for the stats aggregate; ~5 years of daily training

const sessionOut = (d) => ({
  id: String(d._id),
  kind: d.kind,
  name: d.name,
  workoutId: d.workoutId,
  startedAt: d.startedAt,
  durationSec: d.durationSec,
  completed: d.completed,
  phasesDone: d.phasesDone,
  totalPhases: d.totalPhases,
  people: d.people,
  ladder: d.ladder || [],
  stations: d.stations || [],
});

const logOut = (d) => ({
  id: String(d._id),
  exercise: d.exercise,
  sets: d.sets,
  reps: d.reps,
  weight: d.weight,
  unit: d.unit,
  note: d.note,
  source: d.source,
  performedAt: d.performedAt,
  sessionId: d.sessionId ? String(d.sessionId) : null,
});

// ---------------------------------------------------------------- sessions

export async function createSession(req, res) {
  const s = (req.body && req.body.session) || {};
  const name = typeof s.name === 'string' ? s.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'A session needs a name.' });
  if (!['circuit', 'regimen'].includes(s.kind))
    return res.status(400).json({ error: 'kind must be "circuit" or "regimen".' });
  const durationSec = num(s.durationSec, -1);
  if (durationSec < 0 || durationSec > 86400)
    return res.status(400).json({ error: 'durationSec must be 0-86400.' });
  const startedAt = s.startedAt ? new Date(s.startedAt) : new Date();
  if (isNaN(startedAt.getTime()))
    return res.status(400).json({ error: 'startedAt must be a valid date.' });

  const ladder = Array.isArray(s.ladder)
    ? s.ladder.slice(0, 60)
        .filter((p) => Array.isArray(p))
        .map((p) => [Math.max(0, num(p[0])), Math.max(0, num(p[1]))])
    : [];
  const stations = Array.isArray(s.stations)
    ? s.stations.slice(0, 40).map((x) => String(x == null ? '' : x).slice(0, 80))
    : [];

  const doc = await WorkoutSession.create({
    userId: req.user.id,
    kind: s.kind,
    name: name.slice(0, 120),
    workoutId: typeof s.workoutId === 'string' ? s.workoutId.slice(0, 64) : null,
    startedAt,
    durationSec,
    completed: !!s.completed,
    phasesDone: Math.max(0, num(s.phasesDone)),
    totalPhases: Math.max(0, num(s.totalPhases)),
    people: Math.max(1, Math.min(6, num(s.people, 1))),
    ladder,
    stations,
  });
  res.status(201).json({ id: String(doc._id), session: sessionOut(doc) });
}

export async function listSessions(req, res) {
  const q = { userId: req.user.id };
  if (typeof req.query.workoutId === 'string' && req.query.workoutId.trim())
    q.workoutId = req.query.workoutId.trim().slice(0, 64);
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (!isNaN(before.getTime())) q.startedAt = { $lt: before };
  }
  const docs = await WorkoutSession.find(q)
    .sort({ startedAt: -1 })
    .limit(clampLimit(req.query.limit))
    .lean();
  res.json({ sessions: docs.map(sessionOut) });
}

export async function removeSession(req, res) {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(404).json({ error: 'Not found' });
  const doc = await WorkoutSession.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  // A session's logs belong to it; deleting the run must not leave them orphaned.
  await SetLog.deleteMany({ userId: req.user.id, sessionId: doc._id });
  res.status(204).end();
}

// ---------------------------------------------------------------- set logs

export async function createLog(req, res) {
  const l = (req.body && req.body.log) || {};
  const exercise = typeof l.exercise === 'string' ? l.exercise.trim() : '';
  if (!exercise) return res.status(400).json({ error: 'A log needs an exercise name.' });
  const sets = num(l.sets, 1);
  const reps = num(l.reps, 0);
  const weight = num(l.weight, 0);
  if (sets < 0 || sets > 100) return res.status(400).json({ error: 'sets must be 0-100.' });
  if (reps < 0 || reps > 1000) return res.status(400).json({ error: 'reps must be 0-1000.' });
  if (weight < 0 || weight > 10000) return res.status(400).json({ error: 'weight must be 0-10000.' });
  const performedAt = l.performedAt ? new Date(l.performedAt) : new Date();
  if (isNaN(performedAt.getTime()))
    return res.status(400).json({ error: 'performedAt must be a valid date.' });
  if (l.sessionId && !mongoose.isValidObjectId(l.sessionId))
    return res.status(400).json({ error: 'sessionId is not a valid id.' });

  const doc = await SetLog.create({
    userId: req.user.id,
    sessionId: l.sessionId || null,
    exercise: exercise.slice(0, 80),
    exerciseKey: exercise.toLowerCase().slice(0, 80),
    sets,
    reps,
    weight,
    unit: ['lb', 'kg', 'bw'].includes(l.unit) ? l.unit : 'lb',
    note: typeof l.note === 'string' ? l.note.slice(0, 500) : '',
    source: l.source === 'voice' ? 'voice' : 'manual',
    performedAt,
  });
  res.status(201).json({ id: String(doc._id), log: logOut(doc) });
}

export async function listLogs(req, res) {
  const q = { userId: req.user.id };
  if (typeof req.query.exercise === 'string' && req.query.exercise.trim())
    q.exerciseKey = req.query.exercise.trim().toLowerCase();
  if (typeof req.query.sessionId === 'string' && mongoose.isValidObjectId(req.query.sessionId))
    q.sessionId = req.query.sessionId;
  const docs = await SetLog.find(q)
    .sort({ performedAt: -1 })
    .limit(clampLimit(req.query.limit))
    .lean();
  res.json({ logs: docs.map(logOut) });
}

// Attach an already-saved log to a session. Sets are written the moment they are logged — a set
// you spoke must not be lost if the tab closes mid-workout — but the session they belong to only
// gets an id when the run ends, so the link is made afterwards.
export async function updateLog(req, res) {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(404).json({ error: 'Not found' });
  const sessionId = (req.body && req.body.sessionId) || null;
  if (sessionId !== null) {
    if (!mongoose.isValidObjectId(sessionId))
      return res.status(400).json({ error: 'sessionId is not a valid id.' });
    // The session must belong to this user, or a log could be linked into someone else's history.
    const owned = await WorkoutSession.exists({ _id: sessionId, userId: req.user.id });
    if (!owned) return res.status(404).json({ error: 'Not found' });
  }
  const doc = await SetLog.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: { sessionId } },
    { new: true }
  );
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json({ log: logOut(doc) });
}

export async function removeLog(req, res) {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(404).json({ error: 'Not found' });
  const doc = await SetLog.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
}

// ---------------------------------------------------------------- stats

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

// Monday of the week a date falls in, as a YYYY-MM-DD key. Weeks are the unit the History
// chart plots, so they are computed once here rather than in the browser.
function weekKey(d) {
  const x = new Date(d);
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString().slice(0, 10);
}

// Consecutive days, ending today or yesterday, with at least one session.
function streakFromDays(daySet, today) {
  const cur = new Date(today);
  if (!daySet.has(dayKey(cur))) {
    cur.setUTCDate(cur.getUTCDate() - 1);
    if (!daySet.has(dayKey(cur))) return 0;
  }
  let n = 0;
  while (daySet.has(dayKey(cur))) {
    n++;
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return n;
}

export async function stats(req, res) {
  const userId = req.user.id;
  const weeks = Math.max(1, Math.min(52, parseInt(req.query.weeks) || 12));

  const sessions = await WorkoutSession.find({ userId })
    .select('startedAt durationSec completed name workoutId kind')
    .sort({ startedAt: -1 })
    .limit(MAX_SCAN)
    .lean();

  const totalSessions = sessions.length;
  const totalSeconds = sessions.reduce((a, s) => a + (s.durationSec || 0), 0);
  const days = new Set(sessions.map((s) => dayKey(s.startedAt)));
  const currentStreakDays = streakFromDays(days, new Date());

  // One bucket per week, oldest first, including the weeks with nothing in them — a gap is
  // information, and the chart must be able to draw it.
  const byWeek = new Map();
  sessions.forEach((s) => {
    const k = weekKey(s.startedAt);
    const b = byWeek.get(k) || { week: k, sessions: 0, seconds: 0 };
    b.sessions += 1;
    b.seconds += s.durationSec || 0;
    byWeek.set(k, b);
  });
  const weekly = [];
  const cursor = new Date(weekKey(new Date()));
  cursor.setUTCDate(cursor.getUTCDate() - 7 * (weeks - 1));
  for (let i = 0; i < weeks; i++) {
    const k = cursor.toISOString().slice(0, 10);
    weekly.push(byWeek.get(k) || { week: k, sessions: 0, seconds: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  // What you run most, and how a given workout has gone — both answer "your history with
  // this one" without shipping every session to the client.
  const byWorkout = new Map();
  sessions.forEach((s) => {
    const key = s.workoutId || s.name;
    const b = byWorkout.get(key) || {
      key, name: s.name, workoutId: s.workoutId || null, kind: s.kind,
      runs: 0, seconds: 0, completed: 0, lastAt: s.startedAt,
    };
    b.runs += 1;
    b.seconds += s.durationSec || 0;
    if (s.completed) b.completed += 1;
    if (new Date(s.startedAt) > new Date(b.lastAt)) b.lastAt = s.startedAt;
    byWorkout.set(key, b);
  });
  const topWorkouts = [...byWorkout.values()].sort((a, b) => b.runs - a.runs).slice(0, 10);

  const topExercises = await SetLog.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(String(userId)) } },
    {
      $group: {
        _id: '$exerciseKey',
        exercise: { $first: '$exercise' },
        sets: { $sum: '$sets' },
        maxWeight: { $max: '$weight' },
      },
    },
    { $sort: { sets: -1 } },
    { $limit: 10 },
    { $project: { _id: 0, exercise: 1, sets: 1, maxWeight: 1 } },
  ]);

  res.json({
    totalSessions,
    totalSeconds,
    currentStreakDays,
    firstSessionAt: sessions.length ? sessions[sessions.length - 1].startedAt : null,
    weekly,
    topWorkouts,
    topExercises,
  });
}
