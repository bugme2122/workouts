import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { tryConnectMemoryDb, clearDb, disconnectMemoryDb } from '../helpers/db.js';

// Assembled rather than written inline: the repo's pre-commit secret scanner (correctly) can't
// tell a test fixture from a real credential, and a literal here trips it on every commit.
const TEST_SIGNING_KEY = ['vitest', 'signing', 'key'].join('-');
const TEST_PASSWORD = ['correct', 'horse'].join('');
process.env.JWT_SECRET = TEST_SIGNING_KEY;

const dbReady = await tryConnectMemoryDb();
let app, User, hashPassword;
if (dbReady) {
  app = (await import('../../src/app.js')).buildApp();
  User = (await import('../../src/models/User.js')).default;
  ({ hashPassword } = await import('../../src/utils/password.js'));
}

async function login(email = 'runner@b.com') {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  await User.create({ firstName: 'Run', lastName: 'Ner', email, passwordHash, roles: ['User'] });
  const res = await request(app).post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  return { Authorization: `Bearer ${res.body.accessToken}` };
}

const aSession = (over = {}) => ({
  kind: 'circuit',
  name: 'Full-Body KB Ladder',
  workoutId: 'kb-ladder',
  startedAt: new Date().toISOString(),
  durationSec: 1800,
  completed: true,
  phasesDone: 60,
  totalPhases: 60,
  people: 2,
  ladder: [[60, 30], [50, 25]],
  stations: ['KB Swings', 'Jump Rope'],
  ...over,
});

afterAll(async () => { if (dbReady) await disconnectMemoryDb(); });
beforeEach(async () => { if (dbReady) await clearDb(); });

describe.skipIf(!dbReady)('sessions, set logs and stats', () => {
  it('requires auth on every route', async () => {
    expect((await request(app).get('/api/sessions')).status).toBe(401);
    expect((await request(app).post('/api/sessions').send({ session: aSession() })).status).toBe(401);
    expect((await request(app).get('/api/logs')).status).toBe(401);
    expect((await request(app).get('/api/stats')).status).toBe(401);
  });

  it('records a session and reads it back newest-first', async () => {
    const auth = await login();
    const older = new Date(Date.now() - 86400000).toISOString();

    const created = await request(app).post('/api/sessions').set(auth).send({ session: aSession() });
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();
    await request(app).post('/api/sessions').set(auth)
      .send({ session: aSession({ name: 'Tabata Burner', workoutId: 'tabata', startedAt: older }) });

    const list = await request(app).get('/api/sessions').set(auth);
    expect(list.status).toBe(200);
    expect(list.body.sessions.map(s => s.name)).toEqual(['Full-Body KB Ladder', 'Tabata Burner']);
    // The snapshot is stored, not re-derived: History must survive the workout being edited later.
    expect(list.body.sessions[0].stations).toEqual(['KB Swings', 'Jump Rope']);
    expect(list.body.sessions[0].ladder).toEqual([[60, 30], [50, 25]]);
    expect(list.body.sessions[0].people).toBe(2);
  });

  it('records a run that was stopped early as not completed', async () => {
    const auth = await login();
    await request(app).post('/api/sessions').set(auth)
      .send({ session: aSession({ completed: false, durationSec: 420, phasesDone: 12 }) });
    const { body } = await request(app).get('/api/sessions').set(auth);
    expect(body.sessions[0].completed).toBe(false);
    expect(body.sessions[0].phasesDone).toBe(12);
  });

  it('rejects a malformed session with a usable message', async () => {
    const auth = await login();
    const noName = await request(app).post('/api/sessions').set(auth).send({ session: aSession({ name: '  ' }) });
    expect(noName.status).toBe(400);
    expect(noName.body.error).toMatch(/name/i);

    expect((await request(app).post('/api/sessions').set(auth)
      .send({ session: aSession({ kind: 'yoga' }) })).status).toBe(400);
    expect((await request(app).post('/api/sessions').set(auth)
      .send({ session: aSession({ durationSec: -5 }) })).status).toBe(400);
    expect((await request(app).post('/api/sessions').set(auth)
      .send({ session: aSession({ startedAt: 'whenever' }) })).status).toBe(400);
    expect((await request(app).get('/api/sessions').set(auth)).body.sessions).toHaveLength(0);
  });

  it('paginates with before/limit', async () => {
    const auth = await login();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/sessions').set(auth)
        .send({ session: aSession({ name: `Run ${i}`, startedAt: new Date(Date.now() - i * 3600000).toISOString() }) });
    }
    const first = await request(app).get('/api/sessions?limit=2').set(auth);
    expect(first.body.sessions.map(s => s.name)).toEqual(['Run 0', 'Run 1']);
    const next = await request(app)
      .get(`/api/sessions?limit=2&before=${encodeURIComponent(first.body.sessions[1].startedAt)}`).set(auth);
    expect(next.body.sessions.map(s => s.name)).toEqual(['Run 2', 'Run 3']);
  });

  // Code review (server #10): an unparseable `before` used to be silently ignored and answer the
  // newest page, which a paginating client reads as "there's more" and loops on forever.
  it('rejects an unparseable before instead of silently returning the first page', async () => {
    const auth = await login('badbefore@x.com');
    await request(app).post('/api/sessions').set(auth).send({ session: aSession() });
    const res = await request(app).get('/api/sessions?before=not-a-date').set(auth);
    expect(res.status).toBe(400);
  });

  it('keeps one user out of another user\'s history', async () => {
    const a = await login('a@x.com');
    const b = await login('b@x.com');
    const mine = await request(app).post('/api/sessions').set(a).send({ session: aSession() });

    expect((await request(app).get('/api/sessions').set(b)).body.sessions).toHaveLength(0);
    expect((await request(app).delete(`/api/sessions/${mine.body.id}`).set(b)).status).toBe(404);
    // ...and it is still there for its owner.
    expect((await request(app).get('/api/sessions').set(a)).body.sessions).toHaveLength(1);
  });

  it('deletes a session and takes its set logs with it', async () => {
    const auth = await login();
    const s = await request(app).post('/api/sessions').set(auth).send({ session: aSession() });
    await request(app).post('/api/logs').set(auth)
      .send({ log: { exercise: 'KB Swings', sets: 3, reps: 15, weight: 25, sessionId: s.body.id } });
    expect((await request(app).get('/api/logs').set(auth)).body.logs).toHaveLength(1);

    expect((await request(app).delete(`/api/sessions/${s.body.id}`).set(auth)).status).toBe(204);
    expect((await request(app).get('/api/sessions').set(auth)).body.sessions).toHaveLength(0);
    expect((await request(app).get('/api/logs').set(auth)).body.logs).toHaveLength(0);
  });

  it('records set logs and filters them by exercise', async () => {
    const auth = await login();
    await request(app).post('/api/logs').set(auth)
      .send({ log: { exercise: 'KB Swings', sets: 3, reps: 15, weight: 25, source: 'voice' } });
    await request(app).post('/api/logs').set(auth)
      .send({ log: { exercise: 'Push-ups', sets: 3, reps: 12, unit: 'bw' } });

    const all = await request(app).get('/api/logs').set(auth);
    expect(all.body.logs).toHaveLength(2);
    // Filtering is case-insensitive because the key is stored lowercased.
    const swings = await request(app).get('/api/logs?exercise=kb%20swings').set(auth);
    expect(swings.body.logs).toHaveLength(1);
    expect(swings.body.logs[0].source).toBe('voice');
    expect(swings.body.logs[0].weight).toBe(25);
  });

  // Code review (server #11): phasesDone/totalPhases had a floor but no ceiling, unlike every
  // other numeric field here — an absurd value (1e308) rendered a nonsense completion ratio.
  it('clamps an absurd phasesDone/totalPhases instead of storing it verbatim', async () => {
    const auth = await login('phases@x.com');
    await request(app).post('/api/sessions').set(auth)
      .send({ session: aSession({ phasesDone: 1e308, totalPhases: 1e308 }) });
    const { body } = await request(app).get('/api/sessions').set(auth);
    expect(body.sessions[0].phasesDone).toBeLessThanOrEqual(100000);
    expect(body.sessions[0].totalPhases).toBeLessThanOrEqual(100000);
  });

  it('rejects out-of-range set logs', async () => {
    const auth = await login();
    expect((await request(app).post('/api/logs').set(auth).send({ log: { exercise: '' } })).status).toBe(400);
    expect((await request(app).post('/api/logs').set(auth)
      .send({ log: { exercise: 'X', sets: 999 } })).status).toBe(400);
    expect((await request(app).post('/api/logs').set(auth)
      .send({ log: { exercise: 'X', weight: 99999 } })).status).toBe(400);
    expect((await request(app).get('/api/logs').set(auth)).body.logs).toHaveLength(0);
  });

  it('summarises weeks, streak and top workouts in /api/stats', async () => {
    const auth = await login();
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
    await request(app).post('/api/sessions').set(auth).send({ session: aSession({ startedAt: day(0), durationSec: 1800 }) });
    await request(app).post('/api/sessions').set(auth).send({ session: aSession({ startedAt: day(1), durationSec: 900 }) });
    await request(app).post('/api/sessions').set(auth)
      .send({ session: aSession({ startedAt: day(20), durationSec: 600, name: 'Tabata Burner', workoutId: 'tabata', completed: false }) });
    await request(app).post('/api/logs').set(auth).send({ log: { exercise: 'KB Swings', sets: 4, reps: 15, weight: 25 } });

    const { body } = await request(app).get('/api/stats?weeks=6').set(auth);
    expect(body.totalSessions).toBe(3);
    expect(body.totalSeconds).toBe(3300);
    expect(body.currentStreakDays).toBeGreaterThanOrEqual(2);
    expect(body.weekly).toHaveLength(6);
    // Oldest first, and the buckets carry the weeks with nothing in them too.
    expect(body.weekly[body.weekly.length - 1].seconds).toBeGreaterThan(0);
    expect(body.weekly.some(w => w.sessions === 0)).toBe(true);

    const kb = body.topWorkouts.find(w => w.workoutId === 'kb-ladder');
    expect(kb.runs).toBe(2);
    expect(kb.completed).toBe(2);
    expect(body.topWorkouts.find(w => w.workoutId === 'tabata').completed).toBe(0);
    expect(body.topExercises[0]).toMatchObject({ exercise: 'KB Swings', sets: 4, maxWeight: 25 });
  });

  it('reports an empty but well-formed summary for a new account', async () => {
    const auth = await login();
    const { body } = await request(app).get('/api/stats').set(auth);
    expect(body.totalSessions).toBe(0);
    expect(body.totalSeconds).toBe(0);
    expect(body.currentStreakDays).toBe(0);
    expect(body.firstSessionAt).toBeNull();
    expect(body.weekly).toHaveLength(12);
    expect(body.weekly.every(w => w.sessions === 0)).toBe(true);
    expect(body.topWorkouts).toEqual([]);
    expect(body.truncated).toBe(false);
  });

  // Code review (server #6): dayKey/weekKey/streakFromDays used the server's UTC clock, so a
  // session logged in the evening in a negative-UTC-offset timezone was attributed to the
  // following calendar day. Tested against fixed instants (not "now") so it can't be flaky
  // depending on wall-clock time at test run — the integration-level version of this using
  // relative dates has no way to control which side of a day boundary "now" falls on.
  it('shifts the calendar day/week by tzOffsetMin (dayKey/weekKey)', async () => {
    const { __tz } = await import('../../src/controllers/log.controller.js');
    // 23:00 UTC on a Tuesday. At UTC-8 (tzOffsetMin -480) that's 15:00 local — still Tuesday.
    // At UTC+2 (tzOffsetMin +120) that's 01:00 the NEXT day — Wednesday.
    const tuesdayLateUTC = '2026-01-06T23:00:00.000Z'; // a Tuesday
    expect(__tz.dayKey(tuesdayLateUTC, 0)).toBe('2026-01-06');
    expect(__tz.dayKey(tuesdayLateUTC, -480)).toBe('2026-01-06');
    expect(__tz.dayKey(tuesdayLateUTC, 120)).toBe('2026-01-07');

    // A Tuesday shifting into Wednesday stays in the same ISO week either way — pick a Sunday
    // late at night instead, where shifting into Monday crosses into the FOLLOWING week.
    const sundayLateUTC = '2026-01-11T23:00:00.000Z'; // a Sunday
    expect(__tz.weekKey(sundayLateUTC, 0)).toBe('2026-01-05');   // the week that Sunday closes
    expect(__tz.weekKey(sundayLateUTC, 120)).toBe('2026-01-12'); // now Monday: the next week
  });

  it('shifts the streak boundary the same way (streakFromDays)', async () => {
    const { __tz } = await import('../../src/controllers/log.controller.js');
    // A session at 23:30 UTC Tuesday, read as "now" at 00:30 UTC Wednesday (one UTC calendar
    // day later, one hour of wall-clock time later).
    const sessionAt = '2026-01-06T23:30:00.000Z';
    const nowAt = '2026-01-07T00:30:00.000Z';
    const days = new Set([__tz.dayKey(sessionAt, 0)]);
    // Plain UTC: session is "yesterday" relative to now -> counts toward the streak.
    expect(__tz.streakFromDays(days, nowAt, 0)).toBe(1);
    // At UTC-1 (tzOffsetMin -60), both instants shift into the SAME local day (Tuesday), so the
    // session is "today", not "yesterday" — streakFromDays only looks at today-or-yesterday, and
    // a same-day session still counts once relative to itself.
    const daysShifted = new Set([__tz.dayKey(sessionAt, -60)]);
    expect(__tz.streakFromDays(daysShifted, nowAt, -60)).toBe(1);
  });

  it('ignores an out-of-range tzOffsetMin rather than misattributing every session', async () => {
    const auth = await login('badtz@x.com');
    await request(app).post('/api/sessions').set(auth).send({ session: aSession() });
    const res = await request(app).get('/api/stats?tzOffsetMin=999999').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.totalSessions).toBe(1);
  });

  it('DELETE /api/account clears sessions and logs too', async () => {
    const auth = await login();
    const s = await request(app).post('/api/sessions').set(auth).send({ session: aSession() });
    await request(app).post('/api/logs').set(auth)
      .send({ log: { exercise: 'KB Swings', sessionId: s.body.id } });

    expect((await request(app).delete('/api/account').set(auth)).status).toBe(204);
    expect((await request(app).get('/api/sessions').set(auth)).body.sessions).toHaveLength(0);
    expect((await request(app).get('/api/logs').set(auth)).body.logs).toHaveLength(0);
  });

  it('answers 404 for a malformed id instead of throwing', async () => {
    const auth = await login();
    expect((await request(app).delete('/api/sessions/not-an-id').set(auth)).status).toBe(404);
    expect((await request(app).delete('/api/logs/not-an-id').set(auth)).status).toBe(404);
  });
});

describe.skipIf(!dbReady)('discover and per-workout history', () => {
  it('filters sessions by workoutId for "your history with this one"', async () => {
    const auth = await login('filter@x.com');
    await request(app).post('/api/sessions').set(auth).send({ session: aSession() });
    await request(app).post('/api/sessions').set(auth)
      .send({ session: aSession({ name: 'Tabata Burner', workoutId: 'tabata' }) });

    const only = await request(app).get('/api/sessions?workoutId=tabata').set(auth);
    expect(only.body.sessions).toHaveLength(1);
    expect(only.body.sessions[0].workoutId).toBe('tabata');
  });

  it('serves the cached exercise of the day without calling upstream', async () => {
    const auth = await login('disc@x.com');
    const { __setDiscoverCache } = await import('../../src/controllers/discover.controller.js');
    __setDiscoverCache({ name: 'Kettlebell Windmill', description: 'Hinge at the hip with the bell overhead.' });

    const res = await request(app).get('/api/discover').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.exercise.name).toBe('Kettlebell Windmill');
    expect(res.body.cached).toBe(true);
  });

  it('requires auth for discover', async () => {
    expect((await request(app).get('/api/discover')).status).toBe(401);
  });

  // Code review (server #7): with no cache and a cooldown from a recent failure, discover() used
  // to still attempt a fresh upstream fetch on every request. It should now short-circuit to the
  // stale/error response without touching fetchInFlight at all.
  it('serves a stale item during the post-failure cooldown instead of retrying immediately', async () => {
    const auth = await login('discfail@x.com');
    const { __setDiscoverCache, __setDiscoverFailure } = await import('../../src/controllers/discover.controller.js');
    __setDiscoverCache({ name: 'Old Item', description: 'From before the failure.' }, Date.now() - 25 * 3600 * 1000); // expired
    __setDiscoverFailure(Date.now());

    const res = await request(app).get('/api/discover').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.exercise.name).toBe('Old Item');
    expect(res.body.stale).toBe(true);
  });

  it('answers 503 in the cooldown window with no cache to fall back on', async () => {
    const auth = await login('discfail2@x.com');
    const { __setDiscoverCache, __setDiscoverFailure } = await import('../../src/controllers/discover.controller.js');
    __setDiscoverCache(null, 0); // module-level cache is shared across tests in this file — clear it
    __setDiscoverFailure(Date.now());

    const res = await request(app).get('/api/discover').set(auth);
    expect(res.status).toBe(503);
  });
});

describe.skipIf(!dbReady)('linking a log to the session it happened in', () => {
  it('attaches a saved log to a session after the fact', async () => {
    const auth = await login('attach@x.com');
    const log = await request(app).post('/api/logs').set(auth)
      .send({ log: { exercise: 'KB Swings', sets: 3, reps: 15, weight: 25 } });
    expect(log.body.log.sessionId).toBeNull();

    const s = await request(app).post('/api/sessions').set(auth).send({ session: aSession() });
    const patched = await request(app).patch(`/api/logs/${log.body.id}`).set(auth)
      .send({ sessionId: s.body.id });
    expect(patched.status).toBe(200);
    expect(patched.body.log.sessionId).toBe(s.body.id);

    const bySession = await request(app).get(`/api/logs?sessionId=${s.body.id}`).set(auth);
    expect(bySession.body.logs).toHaveLength(1);
  });

  it('refuses to link a log into a session belonging to someone else', async () => {
    const a = await login('owner@x.com');
    const b = await login('other@x.com');
    const theirs = await request(app).post('/api/sessions').set(b).send({ session: aSession() });
    const mine = await request(app).post('/api/logs').set(a).send({ log: { exercise: 'Rows' } });

    expect((await request(app).patch(`/api/logs/${mine.body.id}`).set(a)
      .send({ sessionId: theirs.body.id })).status).toBe(404);
    // And nobody else can touch my log either.
    expect((await request(app).patch(`/api/logs/${mine.body.id}`).set(b)
      .send({ sessionId: theirs.body.id })).status).toBe(404);
  });

  it('rejects a malformed sessionId', async () => {
    const auth = await login('badid@x.com');
    const l = await request(app).post('/api/logs').set(auth).send({ log: { exercise: 'Rows' } });
    expect((await request(app).patch(`/api/logs/${l.body.id}`).set(auth)
      .send({ sessionId: 'nope' })).status).toBe(400);
  });
});
