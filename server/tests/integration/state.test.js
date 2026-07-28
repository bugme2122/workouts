import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { tryConnectMemoryDb, clearDb, disconnectMemoryDb } from '../helpers/db.js';

process.env.JWT_SECRET = 'test-secret-please-change';

const dbReady = await tryConnectMemoryDb();
let app, User, hashPassword;
if (dbReady) {
  app = (await import('../../src/app.js')).buildApp();
  User = (await import('../../src/models/User.js')).default;
  ({ hashPassword } = await import('../../src/utils/password.js'));
}

async function makeUserAndLogin(email = 'a@b.com') {
  const passwordHash = await hashPassword('correcthorse');
  await User.create({ firstName: 'A', lastName: 'B', email, passwordHash, roles: ['User'] });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'correcthorse' });
  return res.body.accessToken;
}

afterAll(async () => { if (dbReady) await disconnectMemoryDb(); });
beforeEach(async () => { if (dbReady) await clearDb(); });

describe.skipIf(!dbReady)('data API', () => {
  it('requires auth', async () => {
    expect((await request(app).get('/api/state')).status).toBe(401);
    expect((await request(app).get('/api/presets')).status).toBe(401);
    expect((await request(app).get('/api/users/me')).status).toBe(401);
  });

  it('round-trips config via /api/state', async () => {
    const token = await makeUserAndLogin();
    const auth = { Authorization: `Bearer ${token}` };

    expect((await request(app).get('/api/state').set(auth)).body).toEqual({ config: null });

    const config = { stations: [{ ex: 'Squat' }], ladder: [[60, 30]], people: 2 };
    const put = await request(app).put('/api/state').set(auth).send({ config });
    expect(put.status).toBe(200);

    const got = await request(app).get('/api/state').set(auth);
    expect(got.body.config).toEqual(config);
  });

  it('round-trips presets and clears everything on DELETE /api/account', async () => {
    const token = await makeUserAndLogin();
    const auth = { Authorization: `Bearer ${token}` };

    expect((await request(app).get('/api/presets').set(auth)).body).toEqual({ presets: {} });
    await request(app).put('/api/presets').set(auth).send({ presets: { A: { ladder: [[30, 15]] } } });
    expect((await request(app).get('/api/presets').set(auth)).body.presets).toHaveProperty('A');

    expect((await request(app).delete('/api/account').set(auth)).status).toBe(204);
    expect((await request(app).get('/api/presets').set(auth)).body).toEqual({ presets: {} });
    expect((await request(app).get('/api/state').set(auth)).body).toEqual({ config: null });
  });

  it('/api/users/me returns the signed-in profile without passwordHash', async () => {
    const token = await makeUserAndLogin('me@x.com');
    const me = await request(app).get('/api/users/me').set({ Authorization: `Bearer ${token}` });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('me@x.com');
    expect(me.body.passwordHash).toBeUndefined();
  });

  it('isolates state per user — one user never sees another’s config', async () => {
    const tokenA = await makeUserAndLogin('a@x.com');
    const tokenB = await makeUserAndLogin('b@x.com');
    await request(app).put('/api/state').set({ Authorization: `Bearer ${tokenA}` }).send({ config: { people: 1 } });
    const bState = await request(app).get('/api/state').set({ Authorization: `Bearer ${tokenB}` });
    expect(bState.body).toEqual({ config: null }); // B has none of A's data
  });
});
