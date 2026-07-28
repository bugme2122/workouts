import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';
import { verifyPassword, hashPassword, validatePassword } from '../utils/password.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  refreshExpiryDate,
} from '../utils/tokens.js';
import { httpError } from '../utils/httpError.js';
import { serializeUser as publicUser } from '../utils/serializers.js';

// Issue a fresh access+refresh pair and persist the refresh token hash for later revocation.
async function issueTokens(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = generateRefreshToken();
  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: refreshExpiryDate(),
  });
  return { accessToken, refreshToken };
}

// POST /auth/login. Generic error whether the email is unknown or the password is wrong — never
// reveal which. Deactivated accounts get a distinct 403.
export async function login({ email, password }) {
  const generic = httpError(401, 'Invalid email or password.');
  if (!email || !password) throw generic;
  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+passwordHash');
  if (!user) throw generic;
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw generic;
  if (!user.active) throw httpError(403, 'This account has been deactivated.');
  const tokens = await issueTokens(user);
  return { ...tokens, user: publicUser(user) };
}

// POST /auth/refresh — rotate: the presented refresh token is revoked and a new pair issued.
export async function refresh({ refreshToken }) {
  const invalid = httpError(401, 'Invalid or expired refresh token.');
  if (!refreshToken) throw invalid;
  const stored = await RefreshToken.findOne({ tokenHash: hashToken(refreshToken) });
  if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) throw invalid;
  const user = await User.findById(stored.userId);
  if (!user || !user.active) throw invalid;
  stored.revokedAt = new Date();
  await stored.save();
  const tokens = await issueTokens(user);
  return { ...tokens };
}

// POST /auth/logout — revoke the caller's refresh token.
export async function logout({ refreshToken }) {
  if (!refreshToken) return;
  await RefreshToken.updateOne(
    { tokenHash: hashToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

// Reset tokens are JWTs signed with a per-user secret (JWT_SECRET + current passwordHash), so they
// become invalid the moment the password changes — single-use + reuse-after-consume protection
// with no extra collection.
function resetSecret(passwordHash) {
  return `${process.env.JWT_SECRET}.${passwordHash}`;
}

export async function createResetToken(user) {
  return jwt.sign({ sub: String(user._id), purpose: 'reset' }, resetSecret(user.passwordHash), {
    expiresIn: '30m',
  });
}

// POST /auth/forgot-password — returns the (dev) token so the controller can deliver it; the
// controller always responds with the same generic message regardless.
export async function forgotPassword({ email }) {
  const user = await User.findOne({ email: String(email || '').toLowerCase().trim() }).select('+passwordHash');
  if (!user || !user.active) return { user: null, token: null };
  const token = await createResetToken(user);
  return { user, token };
}

// POST /auth/reset-password — invalid/expired/already-used all fail identically.
export async function resetPassword({ token, newPassword }) {
  const invalid = httpError(400, 'Reset link is invalid or has expired.');
  if (!token || !newPassword) throw invalid;
  const decoded = jwt.decode(token);
  if (!decoded?.sub) throw invalid;
  const user = await User.findById(decoded.sub).select('+passwordHash');
  if (!user) throw invalid;
  try {
    jwt.verify(token, resetSecret(user.passwordHash));
  } catch {
    throw invalid; // expired, tampered, or already consumed (passwordHash changed)
  }
  validatePassword(newPassword);
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  // Revoke all outstanding refresh tokens after a password reset.
  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return { user };
}
