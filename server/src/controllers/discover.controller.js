import https from 'node:https';

// One exercise a day from the open wger database (https://wger.de, CC-BY-SA, no key needed).
//
// The browser must NOT call wger directly: the client's CSP is `connect-src 'self'`, and
// widening it would hand a third party every user's IP and referrer. So the server fetches,
// caches, and serves it from our own origin — the CSP stays shut and wger sees one request a
// day from one machine instead of one per visitor.

// `exerciseinfo` is the current endpoint; the older `exercisebaseinfo` now 404s. Each result
// carries `translations`, one per language — 2 is English.
const WGER_URL = 'https://wger.de/api/v2/exerciseinfo/?language=2&limit=40&format=json';
const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 4000;

let cache = { at: 0, item: null };
// In-flight fetch, shared by concurrent callers so a cold cache costs ONE upstream request no
// matter how many requests arrive while it's warming — without this, N concurrent callers made N
// upstream calls. Separately, a failed fetch is remembered for a short cooldown so a dead upstream
// is retried at most once a minute rather than on every single request (each paying a fresh
// timeout) until the cache warms again.
let fetchInFlight = null;
let lastFailAt = 0;
const FAIL_COOLDOWN_MS = 60 * 1000;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: TIMEOUT_MS, headers: { 'User-Agent': 'ladder-circuit-timer' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('upstream ' + res.statusCode));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
        if (body.length > 2_000_000) { req.destroy(); reject(new Error('upstream too large')); }
      });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('upstream not JSON')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('upstream timeout')); });
    req.on('error', reject);
  });
}

// wger's descriptions are HTML written by contributors. Decode entities FIRST, then strip tags:
// stripping first and decoding after let a double-encoded "&amp;lt;script&amp;gt;" — which has no
// literal "<"/">" for the tag regex to catch — decode, post-strip, into a literal "<script>" in
// the JSON payload. Decoding first turns it into a real tag while there is still a strip pass
// ahead of it, so nothing that arrives here can reach the DOM as markup even if that changes.
function toText(html, max = 420) {
  const s = String(html || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : s;
}

// Same exercise for everyone for a whole day — "today's" should mean the same thing to two
// people in the same garage, and it keeps the upstream request count at one.
function pickForToday(list) {
  const usable = list.filter((x) => x && x.name && x.description);
  if (!usable.length) return null;
  const dayNumber = Math.floor(Date.now() / TTL_MS);
  return usable[dayNumber % usable.length];
}

async function refreshCache() {
  const data = await fetchJson(WGER_URL);
  const items = (data && Array.isArray(data.results) ? data.results : [])
    .map((base) => {
      const all = base.translations || base.exercises || [];
      const tr = all.find((e) => e.language === 2) || all[0];
      return tr && tr.name ? { name: toText(tr.name, 80), description: toText(tr.description) } : null;
    })
    .filter(Boolean);

  const item = pickForToday(items);
  if (!item) throw new Error('no usable exercise in upstream response');
  cache = { at: Date.now(), item };
  return item;
}

export async function discover(req, res) {
  if (cache.item && Date.now() - cache.at < TTL_MS) {
    return res.json({ exercise: cache.item, cached: true });
  }
  if (Date.now() - lastFailAt < FAIL_COOLDOWN_MS) {
    // Upstream failed recently; don't pay another timeout for every request until the cooldown
    // passes. A stale item still beats an error.
    if (cache.item) return res.json({ exercise: cache.item, cached: true, stale: true });
    return res.status(503).json({ error: 'Could not reach the exercise database.' });
  }
  try {
    // Share one in-flight fetch across concurrent callers instead of one upstream call each.
    if (!fetchInFlight) fetchInFlight = refreshCache().finally(() => { fetchInFlight = null; });
    const item = await fetchInFlight;
    res.json({ exercise: item, cached: false });
  } catch (e) {
    lastFailAt = Date.now();
    // A stale item beats an error: this is a nice-to-have, not a feature anything depends on.
    if (cache.item) return res.json({ exercise: cache.item, cached: true, stale: true });
    res.status(503).json({ error: 'Could not reach the exercise database.' });
  }
}

// Test seams: let the integration tests exercise the route without reaching the network.
export function __setDiscoverCache(item, at = Date.now()) {
  cache = { at, item };
}
export function __setDiscoverFailure(at = Date.now()) {
  lastFailAt = at;
}
