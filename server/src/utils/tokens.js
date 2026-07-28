import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

// Access token: short-lived, carries identity + role-set claim.
export function signAccessToken(user) {
  const roles = user.roles ?? [];
  return jwt.sign(
    { sub: String(user._id ?? user.id), roles, email: user.email },
    secret(),
    { expiresIn: ACCESS_EXPIRES }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, secret());
}

// Refresh token: opaque random string (stored hashed server-side). Not a JWT so it can be cheaply
// revoked by deleting/flagging its stored hash.
export function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function refreshExpiryDate(from = new Date()) {
  const ms = parseDurationMs(REFRESH_EXPIRES);
  return new Date(from.getTime() + ms);
}

function parseDurationMs(str) {
  const m = /^(\d+)([smhd])$/.exec(String(str).trim());
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[m[2]];
  return n * unit;
}
