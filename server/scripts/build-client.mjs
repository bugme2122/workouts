// build-client.mjs — minimal "build": copy the vanilla client files from the repo root into
// server/public/ so Express can serve ONLY the app (never server source, docs, .env, node_modules).
// No bundling/transform — BASE_PATH is injected at serve time via the dynamic /base.js route.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');       // server/scripts -> server -> repo root
const outDir = path.resolve(__dirname, '../public');

// Explicit allowlist — the client surface. base.js is included (its committed default is empty;
// the server overrides it at runtime).
const FILES = [
  'index.html',
  'base.js',
  'framebust.js',
  'app.js',
  'engine.js',
  'catalog.js',
  'store.js',
  'auth.js',
  'api.js',
  'styles.css',
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const f of FILES) {
  const src = path.join(repoRoot, f);
  if (!fs.existsSync(src)) {
    console.warn(`[build-client] skip missing ${f}`);
    continue;
  }
  fs.copyFileSync(src, path.join(outDir, f));
  copied++;
}
console.log(`[build-client] copied ${copied}/${FILES.length} files → ${path.relative(repoRoot, outDir)}`);
