import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import stateRoutes from './routes/state.routes.js';
import userRoutes from './routes/users.routes.js';

// Build the Express app. Kept separate from index.js so tests can import it without binding a port.
// Route modules (auth, state, users) are added by later tasks; this scaffold wires health + the
// BASE_PATH mount + static-serving seam so everything else slots in.
export function buildApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.clientOrigin, credentials: true }));
  app.use(express.json());
  // Only trust X-Forwarded-For when explicitly enabled (behind Railway/Cloudflare). Off by default
  // so req.ip can't be spoofed by a direct client.
  app.set('trust proxy', config.trustProxy ? 1 : false);

  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  });

  // Everything mounts under BASE_PATH so the app can live at a subpath (e.g. /workouts behind a
  // Cloudflare route). Empty by default, so local/dev/tests keep plain /api and root paths.
  const base = config.basePath;
  const router = express.Router();

  router.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // --- Route mounting ---
  router.use('/api/auth', authRoutes);
  router.use('/api', stateRoutes); // /api/state, /api/presets, /api/account (verifyJWT per-route)
  router.use('/api/users', userRoutes); // /api/users/me

  // Single-service deploy (E4): serve the staged client (server/public, produced by
  // `npm run build`) under BASE_PATH. The client learns its subpath from a dynamically generated
  // /base.js (strict CSP forbids inline scripts). Relative asset URLs (./app.js, data: manifest)
  // resolve under BASE_PATH automatically, so no <base> tag or HTML rewrite is needed.
  const clientDist = config.clientDist ? path.resolve(config.clientDist) : path.resolve(__dirname, '../public');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    router.get('/base.js', (req, res) => {
      res.type('application/javascript').send(`window.__BASE__=${JSON.stringify(config.basePath || '')};`);
    });
    router.use(express.static(clientDist, { index: false }));
    // Entry + fallback: any non-API GET returns index.html (the app is a single page).
    router.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(base || '/', router);
  app.use(errorHandler);
  return app;
}
