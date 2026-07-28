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
