import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { tryConnectMemoryDb, clearDb, disconnectMemoryDb } from '../helpers/db.js';

process.env.JWT_SECRET = 'test-secret-please-change';

// Connect at collection time so we know whether to run or skip. Import app + models only when the
// DB is available (and after env is set).
const dbReady = await tryConnectMemoryDb();
let app, User, hashPassword;
if (dbReady) {
  app = (await import('../../src/app.js')).buildApp();
  User = (await import('../../src/models/User.js')).default;
  ({ hashPassword } = await import('../../src/utils/password.js'));
}

async function seedUser({ email = 'a@b.com', password = 'correcthorse', active = true, roles = ['User'] } = {}) {
  const passwordHash = await hashPassword(password);
  return User.create({ firstName: 'A', lastName: 'B', email, passwordHash, roles, active });
}

afterAll(async () => { if (dbReady) await disconnectMemoryDb(); });
beforeEach(async () => { if (dbReady) await clearDb(); });

describe.skipIf(!dbReady)('POST /api/auth/login', () => {
  it('issues access + refresh + user on valid credentials', async () => {
    await seedUser();
    const res = await request(app).post('/api/auth/login').send({ email: 'A@B.com', password: 'correcthorse' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toMatch(/^[0-9a-f]{96}$/);
    expect(res.body.user.email).toBe('a@b.com');
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('gives a generic 401 for wrong password AND unknown email (no user enumeration)', async () => {
    await seedUser();
    const wrong = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'nope' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'x@y.com', password: 'whatever' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error); // identical message
  });

  it('gives a distinct 403 for a deactivated account', async () => {
    await seedUser({ active: false });
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'correcthorse' });
    expect(res.status).toBe(403);
  });
});

describe.skipIf(!dbReady)('POST /api/auth/refresh', () => {
  it('rotates: old refresh token is revoked, a new pair is issued', async () => {
    await seedUser();
    const login = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'correcthorse' });
    const rt = login.body.refreshToken;

    const r1 = await request(app).post('/api/auth/refresh').send({ refreshToken: rt });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(rt); // rotated

    // Reusing the old (now revoked) token fails.
    const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken: rt });
    expect(reuse.status).toBe(401);
  });

  it('rejects a bogus refresh token', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'deadbeef' });
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!dbReady)('POST /api/auth/logout', () => {
  it('revokes the refresh token (requires a valid access token)', async () => {
    await seedUser();
    const login = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'correcthorse' });
    const { accessToken, refreshToken } = login.body;

    const out = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });
    expect(out.status).toBe(204);

    // The revoked refresh token can no longer refresh.
    const after = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(after.status).toBe(401);
  });

  it('rejects logout without a valid access token', async () => {
    const res = await request(app).post('/api/auth/logout').send({ refreshToken: 'x' });
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!dbReady)('password reset flow', () => {
  it('forgot returns a generic message; reset with the token changes the password', async () => {
    await seedUser();
    const { createResetToken } = await import('../../src/services/auth.service.js');
    const user = await User.findOne({ email: 'a@b.com' }).select('+passwordHash');
    const token = await createResetToken(user);

    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: 'a@b.com' });
    expect(forgot.status).toBe(200);
    expect(forgot.body.message).toMatch(/if that email exists/i);

    const reset = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'newlongpassword' });
    expect(reset.status).toBe(200);

    // Old password no longer works; new one does.
    const oldLogin = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'correcthorse' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'newlongpassword' });
    expect(newLogin.status).toBe(200);

    // The reset token is single-use (passwordHash changed → signature invalid).
    const reuse = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'anotherlongpw' });
    expect(reuse.status).toBe(400);
  });

  it('there is no self-registration endpoint', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'z@z.com', password: 'x' });
    expect(res.status).toBe(404);
  });
});
