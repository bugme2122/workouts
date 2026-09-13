import rateLimit from 'express-rate-limit';

// Rate limiter for the unauthenticated auth endpoints (login/forgot/reset) to blunt credential
// stuffing and reset-token spam. Effectively disabled under test so integration suites aren't
// throttled; production default is 10 requests / 15 min per IP, overridable via env.
export function authLimiter(opts = {}) {
  const isTest = !!process.env.VITEST;
  const max = opts.max ?? (isTest ? 100000 : Number(process.env.AUTH_RATE_LIMIT_MAX) || 10);
  return rateLimit({
    windowMs: opts.windowMs ?? 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again later.' },
  });
}

// Rate limiter for authenticated write routes (POST /api/sessions, /api/logs) — the 64 KB
// per-document cap (GAPS #16) bounds the SIZE of one write, but nothing bounded the COUNT. A
// compromised or buggy client could otherwise insert documents indefinitely; keyed by the JWT's
// user id (not IP) so it actually limits one account rather than one network address, and mounted
// AFTER verifyJWT so req.user exists when the key function runs.
export function writeLimiter(opts = {}) {
  const isTest = !!process.env.VITEST;
  const max = opts.max ?? (isTest ? 100000 : Number(process.env.WRITE_RATE_LIMIT_MAX) || 120);
  return rateLimit({
    windowMs: opts.windowMs ?? 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?.id || req.ip),
    // The key is a Mongo ObjectId string, not an IP — express-rate-limit's default validation
    // assumes a custom keyGenerator is misconfigured unless it also falls back to IP, and warns
    // (ERR_ERL_KEY_GEN_IPV6) on every request otherwise. That fallback doesn't apply here.
    validate: { keyGeneratorIpFallback: false },
    message: { error: 'Too many writes. Please slow down.' },
  });
}
