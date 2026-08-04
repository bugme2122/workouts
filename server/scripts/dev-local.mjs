// dev-local.mjs — run the whole app on localhost with an embedded MongoDB, no Atlas and no
// system MongoDB install. Intended for development only.
//
//   npm run dev:local
//
// Why this exists: docs/deploy.md targets Atlas, which requires the machine's IP to be on the
// cluster's access list. That is a console action and blocks local work, so this script boots
// `mongodb-memory-server` against a PERSISTENT dbPath (server/.data/mongo) — unlike the default
// throwaway instance, your admin user and saved workouts survive a restart.
//
// It also seeds an admin on first run, because there is no self-registration.
//
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run dev:local
//
// Switching to Atlas later: allowlist your IP, then use `npm start` (which reads MONGODB_URI
// from .env). Nothing here changes the app or its config.
// Load .env first so JWT_SECRET (and any other real settings) are in place before we decide
// what to override. dotenv never overwrites an already-set variable, so the MONGODB_URI we set
// below still wins over the Atlas one in .env.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../.data/mongo');
fs.mkdirSync(dbPath, { recursive: true });

console.log('[dev-local] starting embedded MongoDB (first run downloads a mongod binary)…');
const mongod = await MongoMemoryServer.create({
  instance: { dbPath, storageEngine: 'wiredTiger', dbName: 'workouts' },
});

// Set BEFORE importing the app: `dotenv` does not overwrite variables already present, so this
// wins over any MONGODB_URI in .env without us having to edit that file.
process.env.MONGODB_URI = mongod.getUri('workouts');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.BASE_PATH = process.env.BASE_PATH ?? '';
if (!process.env.JWT_SECRET) {
  // Dev-only fallback so the server can boot on a machine with no .env at all. A real secret
  // still comes from .env / the host's environment.
  const { randomBytes } = await import('node:crypto');
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  console.log('[dev-local] no JWT_SECRET set — generated an ephemeral one for this run');
}
console.log(`[dev-local] mongod ready, data persists in ${path.relative(process.cwd(), dbPath)}`);
console.log(`[dev-local] mongo uri: ${process.env.MONGODB_URI}`);

// Seed an admin if none exists (idempotent; never rewrites an existing user's password).
const { connectDb } = await import('../src/config/db.js');
const { default: User } = await import('../src/models/User.js');
const { hashPassword, validatePassword } = await import('../src/utils/password.js');
await connectDb();

const email = (process.env.ADMIN_EMAIL || 'admin@local.test').toLowerCase().trim();
const existingAdmin = await User.findOne({ roles: 'Admin' });
if (existingAdmin) {
  console.log(`[dev-local] admin already present: ${existingAdmin.email}`);
} else {
  const password = process.env.ADMIN_PASSWORD || 'LocalAdmin!2026';
  validatePassword(password);
  await User.create({
    firstName: process.env.ADMIN_FIRST || 'Local',
    lastName: process.env.ADMIN_LAST || 'Admin',
    email,
    passwordHash: await hashPassword(password),
    roles: ['Admin'],
  });
  console.log('[dev-local] ─────────────────────────────────────────────');
  console.log(`[dev-local]  seeded admin   : ${email}`);
  console.log(`[dev-local]  password       : ${password}`);
  console.log('[dev-local]  change it with: npm run create-admin');
  console.log('[dev-local] ─────────────────────────────────────────────');
}

// Stage the client, then boot the real server entrypoint unchanged.
await import('./build-client.mjs');
await import('../src/index.js');

const shutdown = async () => { try { await mongod.stop(); } catch {} process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
