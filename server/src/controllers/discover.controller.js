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

// wger's descriptions are HTML written by contributors. Strip tags and collapse whitespace:
// the client renders this as text, and nothing that arrives here should be able to reach the DOM
// as markup even if that changes.
function toText(html, max = 420) {
  const s = String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
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

export async function discover(req, res) {
  if (cache.item && Date.now() - cache.at < TTL_MS) {
    return res.json({ exercise: cache.item, cached: true });
  }
  try {
    const data = await fetchJson(WGER_URL);
    const items = (data && Array.isArray(data.results) ? data.results : [])
      .map((base) => {
        const all = base.translations || base.exercises || [];
        const tr = all.find((e) => e.language === 2) || all[0];
        return tr && tr.name ? { name: toText(tr.name, 80), description: toText(tr.description) } : null;
      })
      .filter(Boolean);

    const item = pickForToday(items);
    if (!item) return res.status(502).json({ error: 'No exercise available right now.' });

    cache = { at: Date.now(), item };
    res.json({ exercise: item, cached: false });
  } catch (e) {
    // A stale item beats an error: this is a nice-to-have, not a feature anything depends on.
    if (cache.item) return res.json({ exercise: cache.item, cached: true, stale: true });
    res.status(503).json({ error: 'Could not reach the exercise database.' });
  }
}

// Test seam: lets the integration tests exercise the route without reaching the network.
export function __setDiscoverCache(item, at = Date.now()) {
  cache = { at, item };
}
