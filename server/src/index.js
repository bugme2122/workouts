import 'dotenv/config';
import { buildApp } from './app.js';
import { connectDb } from './config/db.js';
import { config } from './config.js';

async function start() {
  await connectDb();
  const app = buildApp();
  app.listen(config.port, () => console.log(`[server] listening on :${config.port}`));
}

start().catch((err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});
