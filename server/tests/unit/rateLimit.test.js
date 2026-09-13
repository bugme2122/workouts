import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { writeLimiter } from '../../src/middleware/rateLimit.js';

// Code review (server #4): POST /api/sessions and /api/logs had a size cap per document but no
// cap on how MANY a user could write. writeLimiter closes that; tested standalone (not through
// the full app) with an explicit low `max` so the test doesn't depend on — or fight with — the
// VITEST-mode bypass that keeps the real app's default limiter out of every other test's way.
function appWithLimiter(max) {
  const app = express();
  // Stand-in for verifyJWT: attaches req.user so the limiter can key by account.
  app.use((req, res, next) => { req.user = { id: req.headers['x-uid'] || 'anon' }; next(); });
  app.use(writeLimiter({ max, windowMs: 60000 }));
  app.get('/write', (req, res) => res.json({ ok: true }));
  return app;
}

describe('writeLimiter', () => {
  it('allows up to `max` requests then answers 429', async () => {
    const app = appWithLimiter(3);
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/write').set('x-uid', 'u1')).status).toBe(200);
    }
    const blocked = await request(app).get('/write').set('x-uid', 'u1');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many/i);
  });

  it('keys by the JWT user id, not by IP — one user hitting the limit does not throttle another', async () => {
    const app = appWithLimiter(1);
    expect((await request(app).get('/write').set('x-uid', 'u1')).status).toBe(200);
    expect((await request(app).get('/write').set('x-uid', 'u1')).status).toBe(429);
    // Different user, same IP (supertest requests all originate from the same test process) —
    // must NOT be throttled by u1's usage.
    expect((await request(app).get('/write').set('x-uid', 'u2')).status).toBe(200);
  });
});
