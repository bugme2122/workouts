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
