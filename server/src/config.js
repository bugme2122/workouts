// config.js — central, typed-ish accessor for environment. Read once here so the rest of the
// app never scatters process.env reads. Values are resolved lazily (env is loaded by index.js).
export const config = {
  get port() { return Number(process.env.PORT) || 4000; },
  get mongoUri() { return process.env.MONGODB_URI; },
  get jwtSecret() { return process.env.JWT_SECRET; },
  get accessTtl() { return process.env.JWT_ACCESS_EXPIRES_IN || '15m'; },
  get refreshTtl() { return process.env.JWT_REFRESH_EXPIRES_IN || '7d'; },
  // Subpath the whole app (API + static) is mounted under. Empty locally; /workouts in prod.
  get basePath() { return process.env.BASE_PATH || ''; },
  get trustProxy() { return process.env.TRUST_PROXY === 'true'; },
  get clientOrigin() { return process.env.CLIENT_ORIGIN || 'http://localhost:5173'; },
  get authRateLimitMax() { return Number(process.env.AUTH_RATE_LIMIT_MAX) || 10; },
  get emailProvider() { return process.env.EMAIL_PROVIDER || 'stub'; },
  get isProd() { return process.env.NODE_ENV === 'production'; },
  get clientDist() { return process.env.CLIENT_DIST || ''; },
};
