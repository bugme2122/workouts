import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const orig = { base: process.env.BASE_PATH, dist: process.env.CLIENT_DIST };
let app;

beforeAll(async () => {
  await import('../../scripts/build-client.mjs'); // stage server/public from the repo root
  process.env.BASE_PATH = '/workouts';
  process.env.CLIENT_DIST = path.resolve(__dirname, '../../public');
  app = (await import('../../src/app.js')).buildApp();
});
afterAll(() => {
  if (orig.base === undefined) delete process.env.BASE_PATH; else process.env.BASE_PATH = orig.base;
  if (orig.dist === undefined) delete process.env.CLIENT_DIST; else process.env.CLIENT_DIST = orig.dist;
});

describe('serving the app under /workouts (E4)', () => {
  it('injects BASE_PATH via a dynamic /base.js (CSP-safe, no inline script)', async () => {
    const res = await request(app).get('/workouts/base.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain('window.__BASE__="/workouts"');
  });

  it('serves index.html (the login app) at the base', async () => {
    const res = await request(app).get('/workouts/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('loginForm');   // email/password login UI
    expect(res.text).toContain('./base.js');    // base loader present, before modules
  });

  it('serves static assets under the base', async () => {
    for (const asset of ['/workouts/app.js', '/workouts/engine.js', '/workouts/styles.css']) {
      const res = await request(app).get(asset);
      expect(res.status, asset).toBe(200);
    }
  });

  it('keeps the API under the base (health)', async () => {
    const res = await request(app).get('/workouts/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('does not serve anything at the root when BASE_PATH is set', async () => {
    expect((await request(app).get('/')).status).toBe(404);
    expect((await request(app).get('/app.js')).status).toBe(404);
  });
});
