import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';

// The scaffold's smoke test: buildApp() must produce a working app WITHOUT a DB connection, so
// the health check can run anywhere (Railway healthcheck hits /<BASE_PATH>/api/health).
describe('health', () => {
  const app = buildApp();

  it('GET /api/health returns ok (no DB required)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('unknown route falls through to a JSON error, not a crash', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
  });
});
