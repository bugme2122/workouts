import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
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

  // Single-service deploy seam: serve the built static app + fallback when a build dir is present.
  // E4 wires CLIENT_DIST + BASE_PATH injection; absent here so the scaffold stays API-only.
  const clientDist = config.clientDist && path.resolve(config.clientDist);
  if (clientDist && fs.existsSync(clientDist)) {
    router.use(express.static(clientDist));
    router.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(base || '/', router);
  app.use(errorHandler);
  return app;
}
